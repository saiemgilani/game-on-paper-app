"""GOP telemetry: in-memory buffer + batched INSERTs into the gop schema.

Python is the SINGLE Postgres client for GOP telemetry: it writes its own
events and everything the Astro frontend ships to POST /gop/ingest.
FAIL-OPEN: nothing here may raise into a request path or crash the worker.
"""

import json
import logging
import os
import threading
import time
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timezone

_TABLES = {
    "request_log": [
        "ts",
        "service",
        "method",
        "path",
        "route_pattern",
        "status",
        "duration_ms",
        "ip",
        "ua",
        "referrer",
        "game_id",
        "bytes_out",
        "cache_status",
        "render_outcome",
        "missing_datasets",
    ],
    "upstream_log": [
        "ts",
        "service",
        "target",
        "status",
        "duration_ms",
        "ok",
        "game_id",
        "error",
    ],
    "error_log": [
        "ts",
        "service",
        "level",
        "message",
        "stack",
        "path",
        "game_id",
        "context",
    ],
    "client_event": ["ts", "type", "name", "value", "path", "game_id", "ua", "ip"],
    "system_stat": [
        "ts",
        "service",
        "rss_mb",
        "heap_mb",
        "cpu_pct",
        "event_loop_lag_ms",
        "redis_mem_mb",
    ],
}

# Columns whose values arrive as strings but need an explicit cast in the
# INSERT (psycopg sends str as text; PG won't implicitly cast text->inet/jsonb).
_CASTS = {"ip": "::inet", "context": "::jsonb"}

_SQL = {
    table: "INSERT INTO gop.%s (%s) VALUES (%s)"
    % (table, ",".join(cols), ",".join("%s" + _CASTS.get(c, "") for c in cols))
    for table, cols in _TABLES.items()
}

log = logging.getLogger("app.telemetry")


class Telemetry:
    def __init__(
        self,
        dsn=None,
        service="python",
        enabled=None,
        flush_s=5.0,
        max_buffer=5000,
        batch_rows=500,
        conn_factory=None,
    ):
        self.dsn = dsn if dsn is not None else os.environ.get("GOP_PG_DSN")
        if enabled is None:
            enabled = os.environ.get("TELEMETRY_ENABLED", "1") != "0" and bool(
                self.dsn or conn_factory
            )
        self.enabled = enabled
        self.service = service
        self.flush_s = flush_s
        self.max_buffer = max_buffer
        self.batch_rows = batch_rows
        self._conn_factory = conn_factory or self._default_conn
        self._conn = None
        self._buf = deque()  # O(1) evict/drain; list.pop(0) is O(n) under lock
        self._lock = threading.Lock()
        self._flush_lock = (
            threading.Lock()
        )  # serializes flushes; _conn only touched under it
        self._wake = threading.Event()  # signals worker to flush early at batch_rows
        self.dropped = 0
        self._started = False
        self._host_lock = None   # None=unknown, False=another worker holds it, int=our fd

    def _default_conn(self):
        import psycopg

        return psycopg.connect(self.dsn, connect_timeout=5)

    def push(self, table, row):
        if not self.enabled or table not in _TABLES:
            return
        with self._lock:
            if len(self._buf) >= self.max_buffer:
                self._buf.popleft()
                self.dropped += 1
            r = dict(row)
            r.setdefault("ts", datetime.now(timezone.utc))
            self._buf.append((table, r))
            buffered = len(self._buf)
        if buffered >= self.batch_rows:
            self._wake.set()  # worker flushes; no PG I/O on request threads

    def flush(self):
        if not self.enabled:
            return {"written": 0, "dropped": self.dropped}
        with self._flush_lock:  # serialize flushes: _conn check-then-act must not race
            with self._lock:
                batch = [
                    self._buf.popleft()
                    for _ in range(min(self.batch_rows, len(self._buf)))
                ]
            if not batch:
                return {"written": 0, "dropped": self.dropped}
            by_table = {}
            for table, r in batch:
                by_table.setdefault(table, []).append(r)
            written = 0
            for table, rows in by_table.items():
                cols = _TABLES[table]
                values = [tuple(r.get(c) for c in cols) for r in rows]
                try:
                    if self._conn is None or getattr(self._conn, "closed", False):
                        self._conn = self._conn_factory()
                    with self._conn.cursor() as cur:
                        cur.executemany(_SQL[table], values)
                    self._conn.commit()
                    written += len(rows)
                except Exception:  # fail-open: drop batch, reset connection
                    log.warning(
                        "gop telemetry flush failed; dropped %d rows", len(rows)
                    )
                    with self._lock:
                        self.dropped += len(rows)
                    try:
                        if self._conn is not None:
                            self._conn.close()
                    except Exception:
                        pass
                    self._conn = None
            return {"written": written, "dropped": self.dropped}

    def stats(self):
        with self._lock:
            return {
                "buffered": len(self._buf),
                "dropped": self.dropped,
                "enabled": self.enabled,
            }

    def log_error(
        self, message, level="error", stack=None, path=None, game_id=None, context=None
    ):
        self.push(
            "error_log",
            {
                "service": self.service,
                "level": level,
                "message": str(message)[:500],
                "stack": str(stack)[:4000] if stack else None,
                "path": str(path)[:300] if path else None,
                "game_id": game_id,
                "context": json.dumps(context) if context else None,
            },
        )

    def _sample_system(self):
        """Emit one per-worker sample, plus a host-level sample from one worker.

        VmRSS/process_time are per-PROCESS: under gunicorn every worker reports
        its own numbers as service='python', so those rows alone cannot answer
        "is the box saturated?". The lowest-PID worker additionally emits a
        service='python-host' row carrying loadavg and host memory, which is
        what capacity planning actually needs.
        """
        try:
            rss_mb = cpu_pct = None
            try:
                with open("/proc/self/status") as f:
                    for line in f:
                        if line.startswith("VmRSS:"):
                            rss_mb = float(line.split()[1]) / 1024.0
                            break
            except OSError:
                pass
            now_cpu, now_t = time.process_time(), time.monotonic()
            last = getattr(self, "_last_cpu", None)
            if last:
                dt_wall = now_t - last[1]
                if dt_wall > 0:
                    cpu_pct = 100.0 * (now_cpu - last[0]) / dt_wall
            self._last_cpu = (now_cpu, now_t)
            self.push(
                "system_stat",
                {
                    "service": self.service,
                    "rss_mb": rss_mb,
                    "heap_mb": None,
                    "cpu_pct": cpu_pct,
                    "event_loop_lag_ms": None,
                    "redis_mem_mb": None,
                },
            )
            self._sample_host()
        except Exception:
            pass

    def _is_host_reporter(self):
        """True in exactly one worker, decided by an flock held for the process life.

        Not "lowest pid": under gunicorn the arbiter is pid 1 and it never runs
        this loop, so a pid comparison would elect nobody. The lock is held on
        an fd we keep open; if that worker is recycled the kernel drops the lock
        and the next worker to tick picks the job up.
        """
        if self._host_lock is not None:
            return self._host_lock is not False
        try:
            import fcntl
            fd = os.open("/tmp/.gop-host-reporter.lock", os.O_CREAT | os.O_RDWR, 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                os.close(fd)
                self._host_lock = False
                return False
            self._host_lock = fd       # keep the fd open to hold the lock
            return True
        except Exception:
            self._host_lock = False
            return False

    def _sample_host(self):
        """Host-wide load + memory, emitted by a single elected worker.

        Exactly one worker reports, elected as the lowest live pid, so a
        recycled worker just hands the job to the next one. cpu_pct here is
        loadavg(1m) normalised to core count, so 100 means 'fully committed'
        regardless of how many workers are configured.
        """
        try:
            if not self._is_host_reporter():
                return
            cores = os.cpu_count() or 1
            load1 = None
            try:
                with open("/proc/loadavg") as f:
                    load1 = float(f.read().split()[0])
            except (OSError, ValueError):
                pass
            mem_used_mb = None
            try:
                info = {}
                with open("/proc/meminfo") as f:
                    for line in f:
                        k, _, v = line.partition(":")
                        info[k] = float(v.split()[0]) / 1024.0
                total = info.get("MemTotal")
                avail = info.get("MemAvailable")
                if total is not None and avail is not None:
                    mem_used_mb = total - avail
            except (OSError, ValueError):
                pass
            self.push(
                "system_stat",
                {
                    "service": "python-host",
                    "rss_mb": mem_used_mb,
                    "heap_mb": float(cores),
                    "cpu_pct": (100.0 * load1 / cores) if load1 is not None else None,
                    "event_loop_lag_ms": None,
                    "redis_mem_mb": None,
                },
            )
        except Exception:
            pass

    def start(self):
        if not self.enabled or self._started:
            return
        self._started = True

        def run():
            last_sample = 0.0
            while True:
                self._wake.wait(timeout=self.flush_s)  # early wakeup at batch_rows
                self._wake.clear()
                if time.monotonic() - last_sample >= 30.0:  # time-based: eager
                    self._sample_system()  # wakeups would skew a counter
                    last_sample = time.monotonic()
                try:
                    self.flush()
                except Exception:
                    pass

        threading.Thread(target=run, daemon=True, name="gop-telemetry").start()


@contextmanager
def stage(timings, name):
    t0 = time.perf_counter()
    try:
        yield
    finally:
        timings[name + "_ms"] = (time.perf_counter() - t0) * 1000.0


def init_flask(app, tel):
    """Register request hooks. Imported lazily so unit tests don't need flask."""
    from flask import g, request

    @app.before_request
    def _gop_before():
        g.gop_t0 = time.perf_counter()
        g.gop_meta = {}

    @app.after_request
    def _gop_after(response):
        try:
            if request.path.startswith("/gop/"):
                return response  # don't log telemetry's own traffic
            meta = getattr(g, "gop_meta", {}) or {}
            tel.push(
                "request_log",
                {
                    "service": tel.service,
                    "method": request.method,
                    "path": request.path[:300],
                    "route_pattern": str(request.url_rule)
                    if request.url_rule
                    else request.path[:300],
                    "status": response.status_code,
                    "duration_ms": (
                        time.perf_counter() - getattr(g, "gop_t0", time.perf_counter())
                    )
                    * 1000.0,
                    "ip": request.remote_addr,
                    "ua": (request.headers.get("User-Agent") or "")[:400],
                    "referrer": (request.headers.get("Referer") or "")[:400] or None,
                    "game_id": meta.get("game_id"),
                    "bytes_out": response.content_length,
                    "cache_status": meta.get("cache_status"),
                    "render_outcome": meta.get("render_outcome"),
                    "missing_datasets": meta.get("missing_datasets"),
                },
            )
        except Exception:
            pass
        return response


TEL = Telemetry()
