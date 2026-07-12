# GOP Admin Observability Implementation Plan (AE/cloudflare base)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the AE/cloudflare GOP stack (Astro SSR + Flask) end-to-end, persist telemetry to a new `gop` schema on the sdv-data Postgres via a python-owned ingest/writer, and ship a basic-auth `/admin` dashboard with per-page dataset-manifest drill-downs.

**Architecture:** Astro (Cloudflare Worker runtime — no long-lived PG pools or cross-request buffers) emits one fire-and-forget ingest POST per request; **python is the single Postgres client**: buffered batch writer + `POST /gop/ingest` + read-only `/gop/admin/*` SQL endpoints. Fail-open everywhere.

**Tech Stack:** Astro `^6.3.7` (cloudflare adapter, `nodejs_compat`), Svelte 5, Chart.js `^4.5.1` (already a dep); Flask 3 + gunicorn, `psycopg[binary]` 3, uv-managed `python/pyproject.toml`; Postgres 16 on sdv-data; vitest (astro) + pytest (python).

**Spec:** `docs/superpowers/specs/2026-07-11-admin-observability-design.md` (approved, retargeted). Branch: `feat/admin-observability` (based on `origin/AE/cloudflare`).

## Global Constraints

- Two repos: app work in `c:\Users\saiem\Documents\GitHub-Data\game-on-paper-dev\game-on-paper-app` on `feat/admin-observability`; schema/runbook work in `c:\Users\saiem\Documents\GitHub-Data\sdv-dev\sdv-db` on `feat/gop-telemetry` (create off `main`).
- **Fail-open everywhere**: telemetry must never throw into a request path, block a render, or crash a service. Python buffer cap 5,000 / drop-oldest / flush 5 s or 500 rows. Astro ingest POST: 3 s timeout, fire-and-forget (`locals.runtime?.ctx?.waitUntil` when present).
- The vestigial `node/` Express app is OUT of scope — do not touch it.
- Astro `src/lib/*.ts` modules under test must stay **pure** (no `astro:*` imports) so vitest runs them; `astro:env/server` (`getSecret`) is used only in `src/middleware.ts` and `src/pages/**` and passed down as arguments.
- Env names (never commit values): `GOP_PG_DSN`, `GOP_PG_DSN_RO`, `GOP_INGEST_KEY` (shared astro↔python), `ADMIN_USER`, `ADMIN_PASS`, `TELEMETRY_ENABLED` (`0` disables), existing `PYTHON_HTTP_URL`.
- Vocabulary (exact strings): services `astro`/`python`/`client`; outcomes `ok`/`degraded`/`failed`; targets `espn_pbp`/`espn_scoreboard`/`espn_schedule`/`flask_process`/`summary`/`other`.
- Conventional Commits; **never add AI co-author trailers**. Droplet ops ship as runbook only.
- Python commands run via uv from `python/` (`uv run pytest`, `uv add`); astro commands via npm from `astro/` (node >= 22.12).

## File Structure

```
game-on-paper-app/
  astro/
    src/lib/telemetry.ts          # NEW — collector, ALS store, classifyTarget, timedFetch, sendToIngest, validateClientEvent
    src/lib/adminAuth.ts          # NEW — pure basic-auth check
    src/lib/manifest.ts           # NEW — GAME_PAGE_MANIFEST, evaluateManifest, salvageGame
    src/middleware.ts             # NEW — request logging + ingest emit + /admin basic auth
    src/pages/api/client-log.ts   # NEW — beacon ingest (rate-limited, forwards to python)
    src/pages/admin/index.astro   # NEW — dashboard (6 tabs + page drill-down, Chart.js)
    src/pages/admin/api/[name].ts # NEW — authenticated proxy to python /gop/admin/<name>
    src/components/Scripts.astro  # MODIFY — client beacon <script is:inline>
    src/components/game/GamePage.astro # MODIFY — manifest evaluation + salvage
    package.json                  # MODIFY — vitest devDep + test script
    test/*.test.ts                # NEW — telemetry/adminAuth/manifest unit tests
  python/
    telemetry.py                  # NEW — buffer + psycopg batch writer + sampler + stage() + init_flask
    gop_routes.py                 # NEW — Blueprint: POST /gop/ingest + GET /gop/admin/<name>
    app.py                        # MODIFY — register blueprint, stage timings, error capture
    pyproject.toml                # MODIFY — psycopg[binary] dep, pytest dev group (via uv add)
    tests/test_telemetry.py       # NEW
    tests/test_gop_routes.py      # NEW
  docker-compose.yml              # MODIFY — python env passthrough
  docker-compose.do.yml           # MODIFY — python env passthrough
  astro/.env.example              # NEW
  scripts/seed_gop.py             # NEW — PEP-723 seed script for local dashboard dev
  README.md                       # MODIFY — admin section

sdv-db/
  infra/postgresql/03_gop_schema.sql   # NEW
  infra/postgresql/gop_prune.sql       # NEW
  systemd/gop-prune.service / .timer   # NEW
  docs/gop-telemetry-runbook.md        # NEW
```

---

### Task 1: `gop` schema, roles, retention, runbook (sdv-db repo)

**Files:**
- Create: `infra/postgresql/03_gop_schema.sql`
- Create: `infra/postgresql/gop_prune.sql`
- Create: `systemd/gop-prune.service`, `systemd/gop-prune.timer`
- Create: `docs/gop-telemetry-runbook.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `gop.*` tables + `gop_writer`/`gop_reader` roles. The column lists are the canonical contract — copy them exactly into `python/telemetry.py` `_TABLES`.

- [ ] **Step 1: Create branch in sdv-db**

```bash
cd "c:/Users/saiem/Documents/GitHub-Data/sdv-dev/sdv-db"
git checkout main && git pull && git checkout -b feat/gop-telemetry
```

- [ ] **Step 2: Write `infra/postgresql/03_gop_schema.sql`**

```sql
-- Game On Paper telemetry schema. Run as postgres superuser on the
-- 'sportsdataverse' database:
--   psql -U postgres -d sportsdataverse \
--        -v gop_writer_pw='<pw1>' -v gop_reader_pw='<pw2>' \
--        -f 03_gop_schema.sql

SET myapp.gop_writer_pw = :'gop_writer_pw';
SET myapp.gop_reader_pw = :'gop_reader_pw';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gop_writer') THEN
        EXECUTE format('CREATE ROLE gop_writer LOGIN PASSWORD %L',
                       current_setting('myapp.gop_writer_pw'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gop_reader') THEN
        EXECUTE format('CREATE ROLE gop_reader LOGIN PASSWORD %L',
                       current_setting('myapp.gop_reader_pw'));
    END IF;
END$$;

CREATE SCHEMA IF NOT EXISTS gop AUTHORIZATION postgres;

CREATE TABLE IF NOT EXISTS gop.request_log (
    ts               timestamptz NOT NULL DEFAULT now(),
    service          text        NOT NULL,
    method           text,
    path             text,
    route_pattern    text,
    status           smallint,
    duration_ms      real,
    ip               inet,
    ua               text,
    referrer         text,
    game_id          text,
    bytes_out        integer,
    cache_status     text,
    render_outcome   text,
    missing_datasets text[]
);

CREATE TABLE IF NOT EXISTS gop.upstream_log (
    ts          timestamptz NOT NULL DEFAULT now(),
    service     text        NOT NULL,
    target      text        NOT NULL,
    status      smallint,
    duration_ms real,
    ok          boolean,
    game_id     text,
    error       text
);

CREATE TABLE IF NOT EXISTS gop.error_log (
    ts      timestamptz NOT NULL DEFAULT now(),
    service text        NOT NULL,
    level   text,
    message text,
    stack   text,
    path    text,
    game_id text,
    context jsonb
);

CREATE TABLE IF NOT EXISTS gop.client_event (
    ts      timestamptz NOT NULL DEFAULT now(),
    type    text NOT NULL,
    name    text,
    value   real,
    path    text,
    game_id text,
    ua      text,
    ip      inet
);

CREATE TABLE IF NOT EXISTS gop.system_stat (
    ts                timestamptz NOT NULL DEFAULT now(),
    service           text NOT NULL,
    rss_mb            real,
    heap_mb           real,
    cpu_pct           real,
    event_loop_lag_ms real,
    redis_mem_mb      real
);

CREATE INDEX IF NOT EXISTS request_log_ts_idx   ON gop.request_log (ts);
CREATE INDEX IF NOT EXISTS request_log_game_idx ON gop.request_log (game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS upstream_log_ts_idx  ON gop.upstream_log (ts);
CREATE INDEX IF NOT EXISTS upstream_log_game_idx ON gop.upstream_log (game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS error_log_ts_idx     ON gop.error_log (ts);
CREATE INDEX IF NOT EXISTS client_event_ts_idx  ON gop.client_event (ts);
CREATE INDEX IF NOT EXISTS system_stat_ts_idx   ON gop.system_stat (ts);

GRANT USAGE ON SCHEMA gop TO gop_writer, gop_reader;
GRANT INSERT ON ALL TABLES IN SCHEMA gop TO gop_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA gop TO gop_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA gop GRANT INSERT ON TABLES TO gop_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA gop GRANT SELECT ON TABLES TO gop_reader;
```

- [ ] **Step 3: Write `infra/postgresql/gop_prune.sql`**

```sql
-- Retention prune for gop telemetry. Run daily (gop-prune.timer).
-- Retention days injected with:  psql -v days=90 -f gop_prune.sql
\set days :days
DELETE FROM gop.request_log  WHERE ts < now() - make_interval(days => :days);
DELETE FROM gop.upstream_log WHERE ts < now() - make_interval(days => :days);
DELETE FROM gop.error_log    WHERE ts < now() - make_interval(days => :days);
DELETE FROM gop.client_event WHERE ts < now() - make_interval(days => :days);
DELETE FROM gop.system_stat  WHERE ts < now() - make_interval(days => :days);
```

- [ ] **Step 4: Write systemd units**

`systemd/gop-prune.service`:

```ini
[Unit]
Description=Prune GOP telemetry older than GOP_RETENTION_DAYS (default 90)

[Service]
Type=oneshot
Environment=GOP_RETENTION_DAYS=90
ExecStart=/usr/bin/psql -U postgres -d sportsdataverse -v days=${GOP_RETENTION_DAYS} -f /opt/sdv-db/infra/postgresql/gop_prune.sql
```

`systemd/gop-prune.timer`:

```ini
[Unit]
Description=Daily GOP telemetry prune

[Timer]
OnCalendar=*-*-* 09:15:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Write `docs/gop-telemetry-runbook.md`**

```markdown
# GOP telemetry — sdv-data droplet runbook (owner-executed)

## 1. Roles + schema
    cd /opt/sdv-db && git pull
    psql -U postgres -d sportsdataverse \
         -v gop_writer_pw='<generate>' -v gop_reader_pw='<generate>' \
         -f infra/postgresql/03_gop_schema.sql

## 2. pg_hba — append (TLS required, GOP python droplet IP only)
    hostssl sportsdataverse gop_writer <GOP_DROPLET_IP>/32 scram-sha-256
    hostssl sportsdataverse gop_reader <GOP_DROPLET_IP>/32 scram-sha-256
Then: `systemctl reload postgresql`.

## 3. DO cloud firewall
Add inbound rule: TCP 5432, source = <GOP_DROPLET_IP>/32 only.
(Do NOT open 5432 to 0.0.0.0/0 — see the Jul 8 incident.)

## 4. Prune timer
    cp systemd/gop-prune.{service,timer} /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now gop-prune.timer

## 5. Hand the secrets to the GOP deploy (never commit):
    GOP_PG_DSN=postgresql://gop_writer:<pw1>@<SDV_DATA_IP>:5432/sportsdataverse?sslmode=require
    GOP_PG_DSN_RO=postgresql://gop_reader:<pw2>@<SDV_DATA_IP>:5432/sportsdataverse?sslmode=require
    GOP_INGEST_KEY=<generate — shared by astro + python; python's /gop/* endpoints
                    are public when Astro runs on Cloudflare Workers, this key is
                    their only gate; rotate it with the admin password>

## Verify
    psql "postgresql://gop_writer:...@<SDV_DATA_IP>:5432/sportsdataverse?sslmode=require" \
      -c "INSERT INTO gop.system_stat (service) VALUES ('runbook-test');"
    psql "postgresql://gop_reader:...@..." -c "SELECT count(*) FROM gop.system_stat;"
    psql "postgresql://gop_reader:...@..." -c "INSERT INTO gop.system_stat (service) VALUES ('x');"  # must FAIL
```

- [ ] **Step 6: Verify schema against a throwaway local PG** (keep the container for Tasks 2–9)

```bash
docker run -d --name gop-pg-test -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sportsdataverse -p 5499:5432 postgres:16
sleep 6
docker cp infra/postgresql/03_gop_schema.sql gop-pg-test:/tmp/
docker exec gop-pg-test psql -U postgres -d sportsdataverse -v gop_writer_pw='w' -v gop_reader_pw='r' -f /tmp/03_gop_schema.sql
docker exec gop-pg-test psql -U postgres -d sportsdataverse -c "\dt gop.*"
docker exec gop-pg-test psql "postgresql://gop_writer:w@localhost/sportsdataverse" -c "INSERT INTO gop.system_stat (service) VALUES ('t');"
docker exec gop-pg-test psql "postgresql://gop_reader:r@localhost/sportsdataverse" -c "SELECT count(*) FROM gop.system_stat;"
docker exec gop-pg-test psql "postgresql://gop_reader:r@localhost/sportsdataverse" -c "INSERT INTO gop.system_stat (service) VALUES ('x');" ; echo "exit=$? (must be nonzero)"
```

Expected: 5 tables; writer INSERT ok; reader SELECT ok; reader INSERT fails.
Local DSNs use `sslmode=disable` (the test container has no TLS): `postgresql://gop_writer:w@localhost:5499/sportsdataverse`.

- [ ] **Step 7: Commit (sdv-db)**

```bash
git add infra/postgresql/03_gop_schema.sql infra/postgresql/gop_prune.sql systemd/gop-prune.service systemd/gop-prune.timer docs/gop-telemetry-runbook.md
git commit -m "feat(gop): telemetry schema, scoped roles, retention timer, droplet runbook"
```

---

### Task 2: Python telemetry writer (`telemetry.py`)

**Files:**
- Create: `python/telemetry.py`
- Create: `python/tests/__init__.py` (empty), `python/tests/test_telemetry.py`
- Modify: `python/pyproject.toml` via uv (add `psycopg[binary]`, dev `pytest`)

**Interfaces:**
- Consumes: `gop.*` column contract (Task 1).
- Produces (used by Tasks 3, 9):
  - `_TABLES: dict[str, list[str]]` — all 5 tables (python is now the sole writer, so `client_event` is included).
  - `Telemetry(dsn=None, service='python', enabled=None, flush_s=5.0, max_buffer=5000, batch_rows=500, conn_factory=None)`
  - `TEL` module singleton; `TEL.push(table, row)`, `TEL.flush() -> {'written': int, 'dropped': int}`, `TEL.stats() -> {'buffered','dropped','enabled'}`, `TEL.start()`, `TEL.log_error(message, level='error', stack=None, path=None, game_id=None, context=None)`
  - `stage(timings: dict, name: str)` contextmanager → `timings[name + '_ms']`
  - `init_flask(app, tel)` — before/after_request hooks reading `g.gop_meta` (`game_id`, `cache_status`, `render_outcome`, `missing_datasets`).

- [ ] **Step 1: Add dependencies**

```bash
cd "c:/Users/saiem/Documents/GitHub-Data/game-on-paper-dev/game-on-paper-app/python"
uv add "psycopg[binary]>=3.1"
uv add --dev pytest
```

Expected: `pyproject.toml` gains the dep + a `[dependency-groups] dev`; `uv.lock` updated.

- [ ] **Step 2: Write the failing tests** (`python/tests/test_telemetry.py`)

```python
import sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from telemetry import Telemetry, stage


class FakeConn:
    def __init__(self, log, fail=False):
        self.log, self.fail = log, fail
        self.closed = False
    def cursor(self):
        return self
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def executemany(self, sql, rows):
        if self.fail:
            raise RuntimeError("conn refused")
        self.log.append((sql, list(rows)))
    def commit(self):
        pass
    def close(self):
        self.closed = True


def make(fail=False, **kw):
    log = []
    tel = Telemetry(enabled=True, conn_factory=lambda: FakeConn(log, fail), **kw)
    return tel, log


def test_push_flush_batches_by_table():
    tel, log = make()
    tel.push("upstream_log", {"target": "espn_pbp", "status": 200, "duration_ms": 12.5, "ok": True})
    tel.push("upstream_log", {"target": "espn_pbp", "status": 502, "duration_ms": 40.0, "ok": False})
    out = tel.flush()
    assert out["written"] == 2
    assert len(log) == 1
    sql, rows = log[0]
    assert "gop.upstream_log" in sql
    assert len(rows) == 2


def test_typed_placeholders_for_inet_jsonb_columns():
    tel, log = make()
    tel.push("request_log", {"service": "astro", "ip": "1.2.3.4"})
    tel.push("error_log", {"message": "x", "context": '{"a":1}'})
    tel.push("client_event", {"type": "web_vital", "ip": "1.2.3.4"})
    tel.flush()
    sqls = " ".join(s for s, _ in log)
    assert "%s::inet" in sqls and "%s::jsonb" in sqls
    assert "gop.client_event" in sqls  # python owns ALL five tables now


def test_unknown_table_ignored():
    tel, _ = make()
    tel.push("nope", {"a": 1})
    assert tel.stats()["buffered"] == 0


def test_buffer_caps_and_drops_oldest():
    tel, _ = make(max_buffer=3, batch_rows=100)
    for i in range(5):
        tel.push("system_stat", {"rss_mb": i})
    s = tel.stats()
    assert s["buffered"] == 3 and s["dropped"] == 2


def test_pg_failure_drops_without_raising():
    tel, _ = make(fail=True)
    tel.push("error_log", {"message": "x"})
    out = tel.flush()
    assert out["written"] == 0
    assert tel.stats()["dropped"] == 1


def test_disabled_is_noop():
    tel = Telemetry(enabled=False)
    tel.push("request_log", {"path": "/x"})
    assert tel.flush()["written"] == 0


def test_stage_contextmanager_records_ms():
    timings = {}
    with stage(timings, "espn_fetch"):
        time.sleep(0.01)
    assert timings["espn_fetch_ms"] >= 5
```

- [ ] **Step 3: Run to verify failure**

Run: `cd python && uv run pytest tests/ -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'telemetry'`.

- [ ] **Step 4: Write `python/telemetry.py`**

```python
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
from contextlib import contextmanager
from datetime import datetime, timezone

_TABLES = {
    "request_log": ["ts", "service", "method", "path", "route_pattern", "status",
                    "duration_ms", "ip", "ua", "referrer", "game_id", "bytes_out",
                    "cache_status", "render_outcome", "missing_datasets"],
    "upstream_log": ["ts", "service", "target", "status", "duration_ms", "ok",
                     "game_id", "error"],
    "error_log": ["ts", "service", "level", "message", "stack", "path", "game_id",
                  "context"],
    "client_event": ["ts", "type", "name", "value", "path", "game_id", "ua", "ip"],
    "system_stat": ["ts", "service", "rss_mb", "heap_mb", "cpu_pct",
                    "event_loop_lag_ms", "redis_mem_mb"],
}

# Columns whose values arrive as strings but need an explicit cast in the
# INSERT (psycopg sends str as text; PG won't implicitly cast text->inet/jsonb).
_CASTS = {"ip": "::inet", "context": "::jsonb"}

_SQL = {
    table: "INSERT INTO gop.%s (%s) VALUES (%s)" % (
        table, ",".join(cols),
        ",".join("%s" + _CASTS.get(c, "") for c in cols))
    for table, cols in _TABLES.items()
}

log = logging.getLogger("app.telemetry")


class Telemetry:
    def __init__(self, dsn=None, service="python", enabled=None, flush_s=5.0,
                 max_buffer=5000, batch_rows=500, conn_factory=None):
        self.dsn = dsn if dsn is not None else os.environ.get("GOP_PG_DSN")
        if enabled is None:
            enabled = os.environ.get("TELEMETRY_ENABLED", "1") != "0" and bool(self.dsn or conn_factory)
        self.enabled = enabled
        self.service = service
        self.flush_s = flush_s
        self.max_buffer = max_buffer
        self.batch_rows = batch_rows
        self._conn_factory = conn_factory or self._default_conn
        self._conn = None
        self._buf = []
        self._lock = threading.Lock()
        self.dropped = 0
        self._started = False

    def _default_conn(self):
        import psycopg
        return psycopg.connect(self.dsn, connect_timeout=5)

    def push(self, table, row):
        if not self.enabled or table not in _TABLES:
            return
        with self._lock:
            if len(self._buf) >= self.max_buffer:
                self._buf.pop(0)
                self.dropped += 1
            r = dict(row)
            r.setdefault("ts", datetime.now(timezone.utc))
            self._buf.append((table, r))

    def flush(self):
        if not self.enabled:
            return {"written": 0, "dropped": self.dropped}
        with self._lock:
            batch, self._buf = self._buf[: self.batch_rows], self._buf[self.batch_rows:]
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
            return {"buffered": len(self._buf), "dropped": self.dropped,
                    "enabled": self.enabled}

    def log_error(self, message, level="error", stack=None, path=None,
                  game_id=None, context=None):
        self.push("error_log", {
            "service": self.service, "level": level,
            "message": str(message)[:500],
            "stack": str(stack)[:4000] if stack else None,
            "path": str(path)[:300] if path else None,
            "game_id": game_id,
            "context": json.dumps(context) if context else None,
        })

    def _sample_system(self):
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
            self.push("system_stat", {"service": self.service, "rss_mb": rss_mb,
                                      "heap_mb": None, "cpu_pct": cpu_pct,
                                      "event_loop_lag_ms": None, "redis_mem_mb": None})
        except Exception:
            pass

    def start(self):
        if not self.enabled or self._started:
            return
        self._started = True

        def run():
            n = 0
            while True:
                time.sleep(self.flush_s)
                n += 1
                if n % 6 == 0:  # every ~30s
                    self._sample_system()
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
            tel.push("request_log", {
                "service": tel.service,
                "method": request.method,
                "path": request.path[:300],
                "route_pattern": str(request.url_rule) if request.url_rule else request.path[:300],
                "status": response.status_code,
                "duration_ms": (time.perf_counter() - getattr(g, "gop_t0", time.perf_counter())) * 1000.0,
                "ip": request.remote_addr,
                "ua": (request.headers.get("User-Agent") or "")[:400],
                "referrer": (request.headers.get("Referer") or "")[:400] or None,
                "game_id": meta.get("game_id"),
                "bytes_out": response.content_length,
                "cache_status": meta.get("cache_status"),
                "render_outcome": meta.get("render_outcome"),
                "missing_datasets": meta.get("missing_datasets"),
            })
        except Exception:
            pass
        return response


TEL = Telemetry()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd python && uv run pytest tests/ -v`
Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/saiem/Documents/GitHub-Data/game-on-paper-dev/game-on-paper-app"
git add python/telemetry.py python/tests/ python/pyproject.toml python/uv.lock
git commit -m "feat(telemetry): python buffered pg writer (sole PG client) with fail-open semantics"
```

---

### Task 3: Python `/gop/ingest` + `/gop/admin/*` + app.py wiring

**Files:**
- Create: `python/gop_routes.py`
- Create: `python/tests/test_gop_routes.py`
- Modify: `python/app.py` (imports at top; `process()` at ~line 30; the KeyError/Exception blocks at ~230-249)

**Interfaces:**
- Consumes: `TEL`, `_TABLES`, `stage`, `init_flask` from Task 2.
- Produces:
  - `POST /gop/ingest` — header `X-GOP-Key: $GOP_INGEST_KEY`; body `{"events": [{"table": str, "row": dict}, ...]}` (≤200/batch); 202 `{"ok": true, "accepted": n}`; 401 on bad key. Task 4's `sendToIngest` and Task 7's beacon target this contract.
  - `GET /gop/admin/<name>` for `name` in `overview|games|upstream|errors|traffic|system|page` — same `X-GOP-Key` guard; JSON bodies consumed by Task 8's dashboard (field names below are load-bearing).
  - `gop_routes.bp` Flask Blueprint registered in `app.py`.

- [ ] **Step 1: Write the failing tests** (`python/tests/test_gop_routes.py`)

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest
from flask import Flask

import gop_routes
from telemetry import Telemetry


class SpyTel(Telemetry):
    def __init__(self):
        super().__init__(enabled=True, conn_factory=lambda: None)
        self.pushed = []
    def push(self, table, row):
        self.pushed.append((table, row))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("GOP_INGEST_KEY", "k")
    tel = SpyTel()
    monkeypatch.setattr(gop_routes, "TEL", tel)
    app = Flask(__name__)
    app.register_blueprint(gop_routes.bp)
    c = app.test_client()
    c.tel = tel
    return c


def test_ingest_requires_key(client):
    r = client.post("/gop/ingest", json={"events": []})
    assert r.status_code == 401
    r = client.post("/gop/ingest", json={"events": []}, headers={"X-GOP-Key": "wrong"})
    assert r.status_code == 401


def test_ingest_accepts_valid_and_skips_unknown_tables(client):
    r = client.post("/gop/ingest", headers={"X-GOP-Key": "k"}, json={"events": [
        {"table": "request_log", "row": {"service": "astro", "path": "/cfb/", "status": 200}},
        {"table": "drop_tables", "row": {"evil": 1}},
        {"table": "client_event", "row": {"type": "web_vital", "name": "LCP", "value": 2100}},
    ]})
    assert r.status_code == 202
    assert r.get_json()["accepted"] == 2
    assert [t for t, _ in client.tel.pushed] == ["request_log", "client_event"]


def test_ingest_strips_client_supplied_ts(client):
    client.post("/gop/ingest", headers={"X-GOP-Key": "k"}, json={"events": [
        {"table": "request_log", "row": {"service": "astro", "ts": "1999-01-01T00:00:00Z"}},
    ]})
    _, row = client.tel.pushed[0]
    assert "ts" not in row


def test_admin_requires_key_and_knows_names(client, monkeypatch):
    monkeypatch.setattr(gop_routes, "_q", lambda sql, params=None: [])
    assert client.get("/gop/admin/overview").status_code == 401
    r = client.get("/gop/admin/overview", headers={"X-GOP-Key": "k"})
    assert r.status_code == 200
    assert "reqPerMin" in r.get_json()
    assert client.get("/gop/admin/nope", headers={"X-GOP-Key": "k"}).status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `cd python && uv run pytest tests/test_gop_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'gop_routes'`.

- [ ] **Step 3: Write `python/gop_routes.py`**

```python
"""GOP telemetry ingest + admin query endpoints. Guarded by X-GOP-Key.

These endpoints may be internet-reachable when Astro runs on Cloudflare
Workers — the shared key is the gate; unauthenticated requests get 401 and
nothing is buffered.
"""
import os

from flask import Blueprint, jsonify, request

from telemetry import TEL, _TABLES

bp = Blueprint("gop", __name__)

_ro_conn = None


def _authed():
    key = os.environ.get("GOP_INGEST_KEY")
    return bool(key) and request.headers.get("X-GOP-Key") == key


@bp.route("/gop/ingest", methods=["POST"])
def ingest():
    if not _authed():
        return jsonify({"ok": False}), 401
    body = request.get_json(force=True, silent=True) or {}
    events = body.get("events") or []
    accepted = 0
    for e in events[:200]:
        if not isinstance(e, dict):
            continue
        table, row = e.get("table"), e.get("row")
        if table in _TABLES and isinstance(row, dict):
            row.pop("ts", None)  # server assigns ts; client clocks drift
            TEL.push(table, row)
            accepted += 1
    return jsonify({"ok": True, "accepted": accepted}), 202


def _q(sql, params=None):
    """Read-only query via gop_reader. Fail-open: [] on any error."""
    global _ro_conn
    dsn = os.environ.get("GOP_PG_DSN_RO")
    if not dsn:
        return []
    try:
        import psycopg
        if _ro_conn is None or _ro_conn.closed:
            _ro_conn = psycopg.connect(dsn, connect_timeout=5, autocommit=True)
        with _ro_conn.cursor() as cur:
            cur.execute(sql, params or {})
            cols = [d.name for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]
    except Exception:
        try:
            if _ro_conn is not None:
                _ro_conn.close()
        except Exception:
            pass
        _ro_conn = None
        return []


def _overview(args):
    return {
        "reqPerMin": _q("""SELECT date_trunc('minute', ts) AS m, count(*)::int AS n
            FROM gop.request_log WHERE ts > now() - interval '60 minutes' AND service = 'astro'
            GROUP BY 1 ORDER BY 1"""),
        "pct": _q("""SELECT to_timestamp(floor(extract(epoch FROM ts)/300)*300) AS b,
                percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
            FROM gop.request_log WHERE ts > now() - interval '60 minutes' AND service = 'astro'
            GROUP BY 1 ORDER BY 1"""),
        "statusMix": _q("""SELECT (status/100)::int AS klass, count(*)::int AS n
            FROM gop.request_log WHERE ts > now() - interval '1 hour' GROUP BY 1 ORDER BY 1"""),
        "services": _q("""SELECT DISTINCT ON (service) service, ts, rss_mb, cpu_pct
            FROM gop.system_stat ORDER BY service, ts DESC"""),
        "espn": (_q("""SELECT count(*) FILTER (WHERE ok)::int AS oks, count(*)::int AS total
            FROM gop.upstream_log WHERE ts > now() - interval '1 hour' AND target LIKE 'espn%%'""") or [{}])[0],
        "telemetry": TEL.stats(),
    }


def _games(args):
    return {
        "gamesAgg": _q("""SELECT game_id, count(*)::int AS req_30m,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
                max(ts) AS last_req,
                (count(*) FILTER (WHERE cache_status = 'hit'))::float
                  / nullif(count(*) FILTER (WHERE cache_status IS NOT NULL), 0) AS cache_hit,
                count(*) FILTER (WHERE render_outcome = 'degraded')::int AS degraded,
                count(*) FILTER (WHERE render_outcome = 'failed')::int AS failed
            FROM gop.request_log
            WHERE ts > now() - interval '30 minutes' AND game_id IS NOT NULL
            GROUP BY game_id ORDER BY req_30m DESC LIMIT 25"""),
        "lastFetch": _q("""SELECT DISTINCT ON (game_id) game_id, ts, status, duration_ms, ok
            FROM gop.upstream_log WHERE target = 'espn_pbp' AND ts > now() - interval '2 hours'
            ORDER BY game_id, ts DESC"""),
    }


def _upstream(args):
    return {
        "targets": _q("""SELECT target,
                percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                (count(*) FILTER (WHERE ok))::float / nullif(count(*), 0) AS success,
                count(*)::int AS total
            FROM gop.upstream_log WHERE ts > now() - interval '24 hours'
            GROUP BY target ORDER BY target"""),
        "failures": _q("""SELECT date_trunc('hour', ts) AS h,
                count(*) FILTER (WHERE status >= 500)::int AS s5xx,
                count(*) FILTER (WHERE status IS NULL AND ok = false)::int AS timeouts
            FROM gop.upstream_log WHERE ts > now() - interval '24 hours' GROUP BY 1 ORDER BY 1"""),
        "slowest": _q("""SELECT ts, target, game_id, duration_ms, status FROM gop.upstream_log
            WHERE ts > now() - interval '1 hour' ORDER BY duration_ms DESC NULLS LAST LIMIT 10"""),
    }


def _errors(args):
    return {
        "groups": _q("""SELECT service, left(message, 120) AS signature, count(*)::int AS n,
                max(ts) AS last_seen, max(game_id) AS game_id
            FROM gop.error_log WHERE ts > now() - interval '24 hours'
            GROUP BY 1, 2 ORDER BY last_seen DESC LIMIT 50"""),
        "recent": _q("""SELECT ts, service, level, message, stack, path, game_id
            FROM gop.error_log ORDER BY ts DESC LIMIT 20"""),
    }


def _traffic(args):
    return {
        "routes": _q("""SELECT route_pattern, count(*)::int AS n,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
            FROM gop.request_log WHERE ts > now() - interval '1 hour' AND service = 'astro'
            GROUP BY 1 ORDER BY n DESC LIMIT 15"""),
        "ips": _q("""SELECT ip::text AS ip, count(*)::int AS n,
                count(*) FILTER (WHERE status BETWEEN 400 AND 499)::int AS c4xx, max(ua) AS ua
            FROM gop.request_log WHERE ts > now() - interval '1 hour' AND ip IS NOT NULL
            GROUP BY ip ORDER BY n DESC LIMIT 15"""),
        "vitals": _q("""SELECT name, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
            FROM gop.client_event WHERE type = 'web_vital' AND ts > now() - interval '24 hours'
            GROUP BY name"""),
    }


def _system(args):
    return {"series": _q("""SELECT date_trunc('minute', ts) AS m, service,
            avg(rss_mb) AS rss_mb, avg(cpu_pct) AS cpu_pct
        FROM gop.system_stat WHERE ts > now() - interval '6 hours'
        GROUP BY 1, 2 ORDER BY 1""")}


def _page(args):
    p = {"gid": args.get("game_id") or None, "route": args.get("route") or None}
    return {
        "outcomes": _q("""SELECT coalesce(render_outcome, 'ok') AS outcome, count(*)::int AS n
            FROM gop.request_log WHERE ts > now() - interval '1 hour'
              AND (%(gid)s::text IS NULL OR game_id = %(gid)s)
              AND (%(route)s::text IS NULL OR route_pattern = %(route)s)
            GROUP BY 1""", p),
        "missing": _q("""SELECT unnest(missing_datasets) AS dataset, count(*)::int AS n
            FROM gop.request_log
            WHERE ts > now() - interval '24 hours' AND missing_datasets IS NOT NULL
              AND (%(gid)s::text IS NULL OR game_id = %(gid)s)
              AND (%(route)s::text IS NULL OR route_pattern = %(route)s)
            GROUP BY 1 ORDER BY 2 DESC""", p),
        "errors": _q("""SELECT ts, service, message FROM gop.error_log
            WHERE ts > now() - interval '24 hours' AND (%(gid)s::text IS NULL OR game_id = %(gid)s)
            ORDER BY ts DESC LIMIT 10""", p),
        "latest": (_q("""SELECT ts, render_outcome, missing_datasets FROM gop.request_log
            WHERE (%(gid)s::text IS NULL OR game_id = %(gid)s)
              AND render_outcome IN ('degraded', 'failed')
            ORDER BY ts DESC LIMIT 1""", p) or [None])[0],
    }


_ADMIN = {"overview": _overview, "games": _games, "upstream": _upstream,
          "errors": _errors, "traffic": _traffic, "system": _system, "page": _page}


@bp.route("/gop/admin/<name>", methods=["GET"])
def admin(name):
    if not _authed():
        return jsonify({"ok": False}), 401
    fn = _ADMIN.get(name)
    if fn is None:
        return jsonify({"error": "unknown endpoint"}), 404
    return jsonify(fn(request.args))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd python && uv run pytest tests/ -v`
Expected: all tests (Task 2 + Task 3) PASS.

- [ ] **Step 5: Wire into `python/app.py`**

Add to the imports block at the top:

```python
from flask import g
import time
from telemetry import TEL, stage, init_flask
import gop_routes
```

After the existing log setup (immediately after `logs.init_app(app)`):

```python
init_flask(app, TEL)
TEL.start()
app.register_blueprint(gop_routes.bp)
```

In `process()` (route `@app.route("/cfb/process", methods=["POST"])`, ~line 30): add `timings = {}` immediately above the existing `try:`, then inside the try wrap the two pipeline calls (adapt to the exact local names in the file — extraction of 2026-07-11 shows `gameId`, `processed_data`):

```python
        g.gop_meta = {"game_id": str(gameId)}
        processed_data = CFBPlayProcess(gameId=gameId)
        with stage(timings, "espn_fetch"):
            pbp = processed_data.espn_cfb_pbp()
        TEL.push("upstream_log", {
            "service": "python", "target": "espn_pbp", "status": 200,
            "duration_ms": timings["espn_fetch_ms"], "ok": True,
            "game_id": str(gameId), "error": None,
        })
        with stage(timings, "pipeline"):
            processed_data.run_processing_pipeline()
```

In the `except KeyError` block (~line 230), after the existing `logging...error(...)` call add:

```python
        TEL.push("upstream_log", {
            "service": "python", "target": "espn_pbp", "status": None,
            "duration_ms": timings.get("espn_fetch_ms"), "ok": False,
            "game_id": str(gameId) if 'gameId' in locals() else None,
            "error": ("KeyError: %r" % (e,))[:500],
        })
        TEL.log_error("ESPN payload malformed (KeyError: %r)" % (e,), path=request.path,
                      game_id=str(gameId) if 'gameId' in locals() else None)
        g.gop_meta = {**getattr(g, "gop_meta", {}), "render_outcome": "failed"}
```

In the generic `except Exception` block (~line 240), after the existing traceback print add:

```python
        import traceback as _tb
        TEL.log_error(str(e), stack="".join(_tb.format_tb(e.__traceback__))[:4000],
                      path=request.path,
                      game_id=str(gameId) if 'gameId' in locals() else None)
        g.gop_meta = {**getattr(g, "gop_meta", {}), "render_outcome": "failed"}
```

- [ ] **Step 6: Syntax-check + commit**

Run: `cd python && uv run python -m py_compile app.py telemetry.py gop_routes.py && echo OK`
Expected: `OK`.

```bash
git add python/gop_routes.py python/tests/test_gop_routes.py python/app.py
git commit -m "feat(telemetry): /gop/ingest + /gop/admin endpoints, flask stage timings + error capture"
```

---

### Task 4: Astro telemetry library (pure) + vitest

**Files:**
- Create: `astro/src/lib/telemetry.ts`
- Create: `astro/src/lib/adminAuth.ts`
- Create: `astro/test/telemetry.test.ts`, `astro/test/adminAuth.test.ts`
- Modify: `astro/package.json` (vitest devDep + `"test": "vitest run"`)

**Interfaces:**
- Consumes: the ingest contract from Task 3.
- Produces (used by Tasks 5, 6, 7):
  - `gopStorage: AsyncLocalStorage<GopCollector>` — request-scoped collector (works in node dev and Workers via `nodejs_compat`).
  - `createCollector(): GopCollector` where `GopCollector = { game_id, render_outcome, missing_datasets, cache_status, events: GopEvent[] }`.
  - `classifyTarget(url, pythonBase?, summaryBase?): string`.
  - `sendToIngest(events, {url, key}): Promise<void>` — never rejects; 3 s timeout.
  - `timedFetch(url, init?, extra?: {game_id?, pythonBase?, summaryBase?}): Promise<Response>` — drop-in fetch that records an `upstream_log` event into the ALS collector (no-op when no collector).
  - `validateClientEvent(body, ua, ip): GopEvent | null`.
  - `clientIp(headers, fallback?): string | null` — `cf-connecting-ip` → `x-real-ip` → fallback.
  - `checkBasicAuth(header, user?, pass?): boolean` (adminAuth.ts).
  - **Purity rule:** these modules import nothing from `astro:*` — config values are always arguments.

- [ ] **Step 1: Add vitest**

```bash
cd "c:/Users/saiem/Documents/GitHub-Data/game-on-paper-dev/game-on-paper-app/astro"
npm install
npm install -D vitest
```

In `astro/package.json` scripts add: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing tests**

`astro/test/adminAuth.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { checkBasicAuth } from '../src/lib/adminAuth';

describe('checkBasicAuth', () => {
  const good = 'Basic ' + btoa('gop:sekret');
  test('rejects when creds unset', () => {
    expect(checkBasicAuth(good, undefined, undefined)).toBe(false);
    expect(checkBasicAuth(good, 'gop', undefined)).toBe(false);
  });
  test('rejects missing/wrong header', () => {
    expect(checkBasicAuth(null, 'gop', 'sekret')).toBe(false);
    expect(checkBasicAuth('Basic ' + btoa('gop:wrong'), 'gop', 'sekret')).toBe(false);
    expect(checkBasicAuth('Basic ' + btoa('gop:sekretbutlonger'), 'gop', 'sekret')).toBe(false);
  });
  test('accepts valid', () => {
    expect(checkBasicAuth(good, 'gop', 'sekret')).toBe(true);
  });
});
```

`astro/test/telemetry.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  classifyTarget, clientIp, createCollector, gopStorage, sendToIngest,
  timedFetch, validateClientEvent,
} from '../src/lib/telemetry';

afterEach(() => vi.unstubAllGlobals());

describe('classifyTarget', () => {
  test('maps known upstreams', () => {
    const py = 'http://python:7000', sm = 'http://summary:3000';
    expect(classifyTarget('https://cdn.espn.com/core/college-football/playbyplay?gameId=1', py, sm)).toBe('espn_pbp');
    expect(classifyTarget('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard', py, sm)).toBe('espn_scoreboard');
    expect(classifyTarget('https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams', py, sm)).toBe('espn_schedule');
    expect(classifyTarget('http://python:7000/cfb/process', py, sm)).toBe('flask_process');
    expect(classifyTarget('http://summary:3000/', py, sm)).toBe('summary');
    expect(classifyTarget('https://collegefootballdata.com', py, sm)).toBe('other');
  });
});

describe('timedFetch', () => {
  test('records ok upstream event into the ALS collector', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const c = createCollector();
    await gopStorage.run(c, () =>
      timedFetch('http://python:7000/cfb/process', { method: 'POST' },
        { game_id: '401', pythonBase: 'http://python:7000' }));
    expect(c.events).toHaveLength(1);
    const row = c.events[0].row as any;
    expect(c.events[0].table).toBe('upstream_log');
    expect(row.target).toBe('flask_process');
    expect(row.ok).toBe(true);
    expect(row.game_id).toBe('401');
  });
  test('records failure event and rethrows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const c = createCollector();
    await expect(gopStorage.run(c, () => timedFetch('https://cdn.espn.com/core/college-football/playbyplay?gameId=9'))).rejects.toThrow();
    const row = c.events[0].row as any;
    expect(row.ok).toBe(false);
    expect(row.error).toContain('ECONNREFUSED');
    expect(row.game_id).toBe('9');
  });
  test('is a plain fetch when no collector is active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x')));
    const resp = await timedFetch('https://example.com');
    expect(resp.status).toBe(200);
  });
});

describe('sendToIngest', () => {
  test('never rejects on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(sendToIngest([{ table: 'error_log', row: {} }], { url: 'http://x/gop/ingest', key: 'k' }))
      .resolves.toBeUndefined();
  });
  test('no-ops without events or key', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await sendToIngest([], { url: 'http://x', key: 'k' });
    await sendToIngest([{ table: 'error_log', row: {} }], { url: 'http://x', key: '' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('validateClientEvent', () => {
  test('js_error -> error_log row', () => {
    const e = validateClientEvent({ type: 'js_error', name: 'boom', value: 'stack', path: '/cfb/', game_id: '4' }, 'UA', '1.2.3.4')!;
    expect(e.table).toBe('error_log');
    expect((e.row as any).service).toBe('client');
  });
  test('web_vital -> client_event row; junk -> null', () => {
    const e = validateClientEvent({ type: 'web_vital', name: 'LCP', value: 2100, path: '/' }, 'UA', null)!;
    expect(e.table).toBe('client_event');
    expect((e.row as any).value).toBe(2100);
    expect(validateClientEvent({ type: 'nonsense' }, 'UA', null)).toBeNull();
  });
});

describe('clientIp', () => {
  test('prefers cf-connecting-ip, then x-real-ip, then fallback', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))).toBe('1.1.1.1');
    expect(clientIp(new Headers({ 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
    expect(clientIp(new Headers(), '3.3.3.3')).toBe('3.3.3.3');
    expect(clientIp(new Headers())).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd astro && npm test`
Expected: FAIL — cannot resolve `../src/lib/telemetry` / `../src/lib/adminAuth`.

- [ ] **Step 4: Write `astro/src/lib/adminAuth.ts`**

```ts
// Constant-time basic-auth check. Pure (no node:crypto) so it runs
// identically under vitest, node dev, and Cloudflare Workers.
export function checkBasicAuth(header: string | null, user?: string, pass?: string): boolean {
  if (!user || !pass) return false;
  const expected = 'Basic ' + btoa(`${user}:${pass}`);
  if (!header || header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 5: Write `astro/src/lib/telemetry.ts`**

```ts
// GOP telemetry (Astro side): per-request event collector + ingest emitter.
// FAIL-OPEN: nothing here may throw into a render path. PURE module — no
// astro:* imports (vitest runs it directly); config values are arguments.
// AsyncLocalStorage works in node dev and on Workers (nodejs_compat flag,
// already set in astro/wrangler.jsonc).
import { AsyncLocalStorage } from 'node:async_hooks';

export type GopEvent = {
  table: 'request_log' | 'upstream_log' | 'error_log' | 'client_event';
  row: Record<string, unknown>;
};

export type GopCollector = {
  game_id: string | null;
  render_outcome: 'ok' | 'degraded' | 'failed' | null;
  missing_datasets: string[] | null;
  cache_status: string | null;
  events: GopEvent[];
};

export const gopStorage = new AsyncLocalStorage<GopCollector>();

export function createCollector(): GopCollector {
  return { game_id: null, render_outcome: null, missing_datasets: null, cache_status: null, events: [] };
}

export function classifyTarget(url: string, pythonBase?: string, summaryBase?: string): string {
  if (!url) return 'other';
  if (url.includes('cdn.espn.com') && url.includes('playbyplay')) return 'espn_pbp';
  if (url.includes('espn.com') && url.includes('scoreboard')) return 'espn_scoreboard';
  if (url.includes('espn.com')) return 'espn_schedule';
  if (pythonBase && url.startsWith(pythonBase)) return 'flask_process';
  if (summaryBase && url.startsWith(summaryBase)) return 'summary';
  return 'other';
}

export type IngestConfig = { url: string; key: string };

export async function sendToIngest(events: GopEvent[], cfg: IngestConfig): Promise<void> {
  if (!events.length || !cfg.url || !cfg.key) return;
  try {
    await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GOP-Key': cfg.key },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* fail-open: telemetry loss is acceptable, page impact is not */
  }
}

export type TimedFetchExtra = { game_id?: string | null; pythonBase?: string; summaryBase?: string };

export async function timedFetch(url: string, init?: RequestInit, extra: TimedFetchExtra = {}): Promise<Response> {
  const c = gopStorage.getStore();
  const t0 = Date.now();
  const gameId = extra.game_id ?? (url.match(/gameId=(\d+)/) || [])[1] ?? null;
  const target = () => classifyTarget(url, extra.pythonBase, extra.summaryBase);
  try {
    const resp = await fetch(url, init);
    c?.events.push({ table: 'upstream_log', row: {
      service: 'astro', target: target(), status: resp.status,
      duration_ms: Date.now() - t0, ok: resp.ok, game_id: gameId, error: null } });
    return resp;
  } catch (err) {
    c?.events.push({ table: 'upstream_log', row: {
      service: 'astro', target: target(), status: null,
      duration_ms: Date.now() - t0, ok: false, game_id: gameId,
      error: String((err as Error)?.message ?? err).slice(0, 500) } });
    throw err;
  }
}

export type ClientEventBody = { type?: string; name?: unknown; value?: unknown; path?: unknown; game_id?: unknown };

export function validateClientEvent(body: ClientEventBody, ua: string, ip: string | null): GopEvent | null {
  if (body?.type !== 'js_error' && body?.type !== 'web_vital') return null;
  const gameId = body.game_id ? String(body.game_id).slice(0, 20) : null;
  const path = String(body.path ?? '').slice(0, 300);
  if (body.type === 'js_error') {
    return { table: 'error_log', row: {
      service: 'client', level: 'error', message: String(body.name ?? '').slice(0, 500),
      stack: String(body.value ?? '').slice(0, 4000), path, game_id: gameId, context: null } };
  }
  const value = Number(body.value);
  return { table: 'client_event', row: {
    type: body.type, name: String(body.name ?? '').slice(0, 40),
    value: Number.isFinite(value) ? value : null, path, game_id: gameId,
    ua: ua.slice(0, 400), ip } };
}

export function clientIp(headers: Headers, fallback?: string | null): string | null {
  return headers.get('cf-connecting-ip') || headers.get('x-real-ip') || fallback || null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd astro && npm test`
Expected: all vitest tests PASS.

- [ ] **Step 7: Commit**

```bash
git add astro/src/lib/telemetry.ts astro/src/lib/adminAuth.ts astro/test/ astro/package.json astro/package-lock.json
git commit -m "feat(telemetry): astro collector, timedFetch, ingest emitter, client-event validation (+vitest)"
```

---

### Task 5: Astro middleware — request logging, ingest emit, /admin auth

**Files:**
- Create: `astro/src/middleware.ts`

**Interfaces:**
- Consumes: Task 4's lib (`createCollector`, `gopStorage`, `sendToIngest`, `clientIp`), `checkBasicAuth`; secrets via `getSecret` (`astro:env/server`) following the existing pattern in `resources/internal.ts:831`.
- Produces: every SSR request wrapped in `gopStorage.run(collector, ...)` — Tasks 6/7 read+write that collector; `/admin*` behind basic auth; one ingest POST per request.

- [ ] **Step 1: Write `astro/src/middleware.ts`**

```ts
import { defineMiddleware } from 'astro:middleware';
import { getSecret } from 'astro:env/server';
import {
  createCollector, gopStorage, sendToIngest, clientIp, type GopCollector,
} from './lib/telemetry';
import { checkBasicAuth } from './lib/adminAuth';

const GAME_ID_RE = /\/game\/(\d+)/;

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    const ok = checkBasicAuth(context.request.headers.get('authorization'),
      getSecret('ADMIN_USER'), getSecret('ADMIN_PASS'));
    if (!ok) {
      return new Response('auth required', {
        status: 401, headers: { 'WWW-Authenticate': 'Basic realm="gop-admin"' } });
    }
  }

  const key = getSecret('GOP_INGEST_KEY') ?? '';
  const enabled = (getSecret('TELEMETRY_ENABLED') ?? '1') !== '0' && !!key;
  if (!enabled || url.pathname.startsWith('/api/client-log')) return next();

  const collector = createCollector();
  collector.game_id = (url.pathname.match(GAME_ID_RE) || [])[1] ?? null;
  const t0 = Date.now();
  let response: Response;
  try {
    response = await gopStorage.run(collector, () => next());
  } catch (err) {
    collector.render_outcome = 'failed';
    collector.events.push({ table: 'error_log', row: {
      service: 'astro', level: 'error',
      message: String((err as Error)?.message ?? err).slice(0, 500),
      stack: String((err as Error)?.stack ?? '').slice(0, 4000),
      path: url.pathname.slice(0, 300), game_id: collector.game_id, context: null } });
    emit(context, collector, url, 500, t0, key);
    throw err;
  }
  emit(context, collector, url, response.status, t0, key);
  return response;
});

function emit(context: any, c: GopCollector, url: URL, status: number, t0: number, key: string) {
  try {
    // skip static asset noise; page/API/upstream signal only
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/_astro/')) return;
    const h = context.request.headers;
    c.events.push({ table: 'request_log', row: {
      service: 'astro',
      method: context.request.method,
      path: url.pathname.slice(0, 300),
      route_pattern: (context.routePattern as string | undefined) ?? url.pathname.slice(0, 300),
      status,
      duration_ms: Date.now() - t0,
      ip: clientIp(h, safeClientAddress(context)),
      ua: (h.get('user-agent') ?? '').slice(0, 400),
      referrer: (h.get('referer') ?? '').slice(0, 400) || null,
      game_id: c.game_id,
      bytes_out: null,
      cache_status: c.cache_status,
      render_outcome: c.render_outcome,
      missing_datasets: c.missing_datasets,
    } });
    const pythonBase = getSecret('PYTHON_HTTP_URL') || 'http://python:7000';
    const p = sendToIngest(c.events, { url: `${pythonBase}/gop/ingest`, key });
    // Workers: keep the isolate alive for the POST; node dev: fire-and-forget.
    context.locals?.runtime?.ctx?.waitUntil?.(p);
  } catch {
    /* fail-open */
  }
}

function safeClientAddress(context: any): string | null {
  try { return context.clientAddress ?? null; } catch { return null; }
}
```

- [ ] **Step 2: Build check** (middleware has `astro:*` imports, so verification is the build)

Run: `cd astro && npm run build`
Expected: build completes with no errors (warnings acceptable).

- [ ] **Step 3: Commit**

```bash
git add astro/src/middleware.ts
git commit -m "feat(telemetry): astro middleware — request log, per-request ingest emit, /admin basic auth"
```

---

### Task 6: Upstream instrumentation + dataset manifests (degraded vs failed)

**Files:**
- Create: `astro/src/lib/manifest.ts`
- Create: `astro/test/manifest.test.ts`
- Modify: `astro/src/resources/internal.ts` (the `/cfb/process` fetch, ~line 922), `astro/src/resources/summary.ts` (~line 258), `astro/src/resources/espn.ts` (~line 405 and any sibling ESPN `fetch(` sites in that file)
- Modify: `astro/src/components/game/GamePage.astro` (the load block, ~lines 29-40)

**Interfaces:**
- Consumes: `timedFetch`, `gopStorage` (Task 4); the middleware-run collector (Task 5).
- Produces:
  - `GAME_PAGE_MANIFEST: ManifestEntry[]`, `evaluateManifest(manifest, game) -> {outcome, missingNames, requiredMissing}`, `salvageGame(game)`.
  - `request_log.render_outcome` + `missing_datasets` populated for game pages — Task 3's `page` endpoint and Task 8's drill-down consume them.

- [ ] **Step 1: Write the failing manifest tests** (`astro/test/manifest.test.ts`)

```ts
import { describe, expect, test } from 'vitest';
import { GAME_PAGE_MANIFEST, evaluateManifest, salvageGame } from '../src/lib/manifest';

const fullGame = () => ({
  gameInfo: { competitors: [{}, {}] },
  header: { id: '1' },
  boxScore: { teams: [{}, {}] },
  plays: [{ winProbability: { before: 0.5, after: 0.6, added: 0.1 } }],
  pickcenter: [{ spread: -3.5 }],
  leaders: [{ name: 'x' }],
  drives: { previous: [{}] },
});

describe('evaluateManifest', () => {
  test('complete game -> ok', () => {
    const v = evaluateManifest(GAME_PAGE_MANIFEST, fullGame());
    expect(v.outcome).toBe('ok');
    expect(v.missingNames).toEqual([]);
  });
  test('missing optional -> degraded', () => {
    const g: any = fullGame();
    g.plays = [{}]; // plays present, no winProbability on them
    g.pickcenter = [];
    const v = evaluateManifest(GAME_PAGE_MANIFEST, g);
    expect(v.outcome).toBe('degraded');
    expect(v.missingNames).toContain('winprobability');
    expect(v.missingNames).toContain('pickcenter');
    expect(v.requiredMissing).toEqual([]);
  });
  test('missing required -> failed', () => {
    const g: any = fullGame();
    g.plays = [];
    const v = evaluateManifest(GAME_PAGE_MANIFEST, g);
    expect(v.outcome).toBe('failed');
    expect(v.requiredMissing).toContain('plays');
  });
  test('null game -> failed with everything missing', () => {
    const v = evaluateManifest(GAME_PAGE_MANIFEST, null);
    expect(v.outcome).toBe('failed');
    expect(v.missingNames.length).toBe(GAME_PAGE_MANIFEST.length);
  });
  test('check exceptions count as missing (fail-open)', () => {
    const v = evaluateManifest([{ name: 'boom', need: 'optional', check: () => { throw new Error('x'); } }], {});
    expect(v.outcome).toBe('degraded');
    expect(v.missingNames).toEqual(['boom']);
  });
});

describe('salvageGame', () => {
  test('backfills neutral winProbability only where missing', () => {
    const g: any = { plays: [{ text: 'run' }, { winProbability: { before: 0.9, after: 0.8, added: -0.1 } }] };
    salvageGame(g);
    expect(g.plays[0].winProbability).toEqual({ before: 0.5, after: 0.5, added: 0.0 });
    expect(g.plays[1].winProbability.before).toBe(0.9);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd astro && npm test` → cannot resolve `../src/lib/manifest`.

- [ ] **Step 3: Write `astro/src/lib/manifest.ts`**

```ts
// Dataset manifests: which named datasets the game page needs, and whether a
// render was ok / degraded (salvageable) / failed (whole-page error). PURE.

export type ManifestEntry = { name: string; need: 'required' | 'optional'; check: (g: any) => boolean };

export const GAME_PAGE_MANIFEST: ManifestEntry[] = [
  { name: 'header',         need: 'required', check: (g) => !!(g && (g.gameInfo || g.header)) },
  { name: 'plays',          need: 'required', check: (g) => Array.isArray(g?.plays) && g.plays.length > 0 },
  { name: 'boxscore',       need: 'required', check: (g) => !!(g?.boxScore || g?.boxscore) },
  { name: 'winprobability', need: 'optional', check: (g) => Array.isArray(g?.plays) && g.plays.length > 0 && g.plays.every((p: any) => p?.winProbability != null) },
  { name: 'pickcenter',     need: 'optional', check: (g) => Array.isArray(g?.pickcenter) && g.pickcenter.length > 0 },
  { name: 'leaders',        need: 'optional', check: (g) => Array.isArray(g?.leaders) && g.leaders.length > 0 },
  { name: 'drives',         need: 'optional', check: (g) => !!(g?.drives && Array.isArray(g.drives.previous) && g.drives.previous.length > 0) },
];

export function evaluateManifest(manifest: ManifestEntry[], game: unknown) {
  const missing = manifest.filter((m) => {
    try { return !m.check(game ?? {}); } catch { return true; }
  });
  const requiredMissing = missing.filter((m) => m.need === 'required').map((m) => m.name);
  return {
    outcome: (requiredMissing.length ? 'failed' : missing.length ? 'degraded' : 'ok') as 'ok' | 'degraded' | 'failed',
    missingNames: missing.map((m) => m.name),
    requiredMissing,
  };
}

// Neutral backfill so a missing optional dataset cannot crash templates that
// read play.winProbability.before/added/after per play.
export function salvageGame(game: any) {
  if (game && Array.isArray(game.plays)) {
    for (const p of game.plays) {
      if (p && p.winProbability == null) p.winProbability = { before: 0.5, after: 0.5, added: 0.0 };
    }
  }
  return game;
}
```

- [ ] **Step 4: Align manifest field names with the real `ProcessedGame` type, then make tests pass**

Run: `grep -rn "boxScore\|winProbability\|pickcenter\|leaders\b\|drives" astro/src/resources/*.ts astro/src/resources/**/*.ts | head -30`
If the processed-game object uses different key spellings than the manifest checks (e.g. `boxscore` vs `boxScore`), adjust the `check` functions AND the `fullGame()` test fixture to the real names — the defensive dual-spelling checks above already tolerate both common variants.
Then run: `cd astro && npm test` — all manifest tests PASS.

- [ ] **Step 5: Wrap the three upstream fetch sites with `timedFetch`**

In `astro/src/resources/internal.ts`: add `import { timedFetch } from '../lib/telemetry';` and change the `/cfb/process` call (~line 922) from `await fetch(` to:

```ts
    const req = await timedFetch(`${PYTHON_HTTP_URL}/cfb/process`, {
        method: "POST",
        body: JSON.stringify({ gameId })
    }, { game_id: String(gameId), pythonBase: PYTHON_HTTP_URL });
```

In `astro/src/resources/summary.ts` (~line 258): same import (path `../lib/telemetry`), change `await fetch(` to `await timedFetch(` and append the extra arg `{ summaryBase: SUMMARY_HTTP_URL }` after the init object.

In `astro/src/resources/espn.ts`: same import; change EVERY `await fetch(` of an espn.com URL to `await timedFetch(` (no extra arg needed — ESPN URLs self-classify, and `gameId=` in the URL supplies the game id). Find them with: `grep -n "await fetch(" astro/src/resources/espn.ts`.

- [ ] **Step 6: Wire the manifest into `astro/src/components/game/GamePage.astro`**

Add to the frontmatter imports:

```ts
import { GAME_PAGE_MANIFEST, evaluateManifest, salvageGame } from '../../lib/manifest';
import { gopStorage } from '../../lib/telemetry';
```

Replace the existing load block (currently: `let game: ProcessedGame | null = null; try { game = await retrieveProcessedGame(id); } catch (e) { console.error(...) } if (!game) { return Astro.rewrite("/404") }`) with:

```ts
let game: ProcessedGame | null = null;
try {
    game = await retrieveProcessedGame(id);
} catch (e) {
    console.error(`ERROR while loading game ${id}: ${e}`);
}
const gop = gopStorage.getStore();
if (gop) gop.game_id = String(id);
const verdict = evaluateManifest(GAME_PAGE_MANIFEST, game);
if (gop) {
    gop.render_outcome = verdict.outcome;
    gop.missing_datasets = verdict.missingNames.length ? verdict.missingNames : null;
}
if (!game || verdict.requiredMissing.length) {
    if (gop) gop.render_outcome = 'failed';
    return Astro.rewrite("/404");
}
salvageGame(game);
```

(Keep the surrounding code otherwise intact; the `console.error` stays.)

- [ ] **Step 7: Build + test + commit**

Run: `cd astro && npm test && npm run build`
Expected: tests PASS, build clean.

```bash
git add astro/src/lib/manifest.ts astro/test/manifest.test.ts astro/src/resources/internal.ts astro/src/resources/summary.ts astro/src/resources/espn.ts astro/src/components/game/GamePage.astro
git commit -m "feat(admin): upstream timedFetch instrumentation + dataset manifests (ok/degraded/failed)"
```

---

### Task 7: Client beacon + `/api/client-log`

**Files:**
- Create: `astro/src/pages/api/client-log.ts`
- Modify: `astro/src/components/Scripts.astro` (currently 1 line: the bootstrap bundle script)

**Interfaces:**
- Consumes: `validateClientEvent`, `clientIp`, `sendToIngest` (Task 4); python ingest (Task 3).
- Produces: `POST /api/client-log` accepting `{type:'js_error'|'web_vital', name, value, path, game_id}` → 200/400/429. Plausible needs NO work — the tag already ships in `GenericPage.astro:75`.

- [ ] **Step 1: Write `astro/src/pages/api/client-log.ts`**

```ts
import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { clientIp, sendToIngest, validateClientEvent } from '../../lib/telemetry';

export const prerender = false;

// Per-isolate token bucket: 60 events/min/ip. Imperfect on Workers (memory is
// per-isolate) — acceptable; the whole path is fail-open.
const buckets = new Map<string, { n: number; t0: number }>();

export const POST: APIRoute = async (context) => {
  try {
    if (buckets.size > 10000) buckets.clear();
    const ip = clientIp(context.request.headers, safeAddr(context)) ?? 'unknown';
    const now = Date.now();
    const b = buckets.get(ip) ?? { n: 0, t0: now };
    if (now - b.t0 > 60000) { b.n = 0; b.t0 = now; }
    b.n++;
    buckets.set(ip, b);
    if (b.n > 60) return json({ ok: false }, 429);

    const body = await context.request.json().catch(() => null);
    const event = validateClientEvent(body ?? {}, context.request.headers.get('user-agent') ?? '',
      ip === 'unknown' ? null : ip);
    if (!event) return json({ ok: false }, 400);

    const key = getSecret('GOP_INGEST_KEY') ?? '';
    const pythonBase = getSecret('PYTHON_HTTP_URL') || 'http://python:7000';
    const p = sendToIngest([event], { url: `${pythonBase}/gop/ingest`, key });
    (context.locals as any)?.runtime?.ctx?.waitUntil?.(p);
    return json({ ok: true }, 200);
  } catch {
    return json({ ok: true }, 200); // fail-open even here
  }
};

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function safeAddr(context: any): string | null {
  try { return context.clientAddress ?? null; } catch { return null; }
}
```

- [ ] **Step 2: Extend `astro/src/components/Scripts.astro`** — full new file content:

```html
<script is:inline src="/assets/js/bootstrap.bundle.min.js"></script>
<script is:inline>
(function () {
  var gid = (location.pathname.match(/\/game\/(\d+)/) || [])[1] || null;
  function send(payload) {
    try {
      var body = JSON.stringify(Object.assign({ path: location.pathname, game_id: gid }, payload));
      if (navigator.sendBeacon) navigator.sendBeacon('/api/client-log', new Blob([body], { type: 'application/json' }));
      else fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    send({ type: 'js_error', name: String(e.message).slice(0, 300), value: ((e.error && e.error.stack) || '').slice(0, 2000) });
  });
  window.addEventListener('unhandledrejection', function (e) {
    send({ type: 'js_error', name: 'unhandledrejection: ' + String(e.reason).slice(0, 280), value: ((e.reason && e.reason.stack) || '').slice(0, 2000) });
  });
  try {
    var clsVal = 0, lcpVal = 0, inpVal = 0;
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (en) { if (!en.hadRecentInput) clsVal += en.value; }); })
      .observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(function (l) { var es = l.getEntries(); if (es.length) lcpVal = es[es.length - 1].startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(function (l) { l.getEntries().forEach(function (en) { if (en.duration > inpVal) inpVal = en.duration; }); })
      .observe({ type: 'event', buffered: true, durationThreshold: 40 });
    addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden') return;
      if (lcpVal) send({ type: 'web_vital', name: 'LCP', value: lcpVal });
      send({ type: 'web_vital', name: 'CLS', value: clsVal });
      if (inpVal) send({ type: 'web_vital', name: 'INP', value: inpVal });
    }, { once: true });
  } catch (e) {}
})();
</script>
```

- [ ] **Step 3: Build + commit**

Run: `cd astro && npm run build` — clean.

```bash
git add astro/src/pages/api/client-log.ts astro/src/components/Scripts.astro
git commit -m "feat(telemetry): client error/web-vitals beacon + /api/client-log forwarder"
```

---

### Task 8: `/admin` dashboard page + API proxy

**Files:**
- Create: `astro/src/pages/admin/index.astro`
- Create: `astro/src/pages/admin/api/[name].ts`

**Interfaces:**
- Consumes: python `/gop/admin/<name>` JSON shapes (Task 3), basic auth from middleware (Task 5), Chart.js (already in `astro/package.json`).
- Produces: `GET /admin` (six tabs + page drill-down) and `GET /admin/api/{name}` proxy.

- [ ] **Step 1: Write `astro/src/pages/admin/api/[name].ts`**

```ts
import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';

export const prerender = false;

const ALLOWED = ['overview', 'games', 'upstream', 'errors', 'traffic', 'system', 'page'];

export const GET: APIRoute = async ({ params, url }) => {
  const name = params.name ?? '';
  if (!ALLOWED.includes(name)) return new Response('not found', { status: 404 });
  const py = getSecret('PYTHON_HTTP_URL') || 'http://python:7000';
  try {
    const r = await fetch(`${py}/gop/admin/${name}${url.search}`, {
      headers: { 'X-GOP-Key': getSecret('GOP_INGEST_KEY') ?? '' },
      signal: AbortSignal.timeout(10000),
    });
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'python unreachable' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
```

- [ ] **Step 2: Write `astro/src/pages/admin/index.astro`** — standalone page (GOP dark tokens, Chivo/Fira Mono, Chart.js bundled by Vite):

```astro
---
export const prerender = false;
---
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GOP Admin</title>
  <style>
    :root{--bg:#14171c;--surface:#171a21;--card:#1c212a;--line:#2a303b;--ink:#e6e8ec;
      --muted:#98a1ad;--faint:#6b7480;--accent:#d64550;--good:#3fae72;--warn:#d9a441;
      --crit:#e05561;--good-bg:#1a2e24;--warn-bg:#2e2717;--crit-bg:#331b1e;
      --s1:#4d8df0;--s2:#c97a20;--s3:#1d9e7c;--s4:#a95cc6;--grid:#232933;--chip:#242a34}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:"Chivo","Segoe UI",system-ui,sans-serif;font-size:14px;line-height:1.45}
    .mono,td.num{font-family:"Fira Mono",ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
    header{display:flex;align-items:center;gap:14px;padding:10px 18px;background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
    nav{display:flex;gap:2px;padding:0 12px;background:var(--surface);border-bottom:1px solid var(--line);overflow-x:auto}
    nav button{border:0;background:none;color:var(--muted);padding:10px 14px 8px;font:inherit;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
    nav button.on{color:var(--ink);border-bottom-color:var(--accent)}
    main{padding:16px 18px 48px;max-width:1280px;margin:0 auto}
    section{display:none}section.on{display:block}
    h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:22px 0 10px;font-weight:700}
    .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
    .tile,.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;min-width:0}
    .tile span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
    .tile b{display:block;font-size:26px;font-weight:500;margin-top:4px;font-family:"Fira Mono",ui-monospace,Consolas,monospace}
    .grid2{display:grid;grid-template-columns:2fr 1fr;gap:10px}
    .grid2eq{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    @media (max-width:900px){.grid2,.grid2eq{grid-template-columns:1fr}}
    .pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px}
    .pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
    .pill.good{color:var(--good);background:var(--good-bg)}
    .pill.warn{color:var(--warn);background:var(--warn-bg)}
    .pill.crit{color:var(--crit);background:var(--crit-bg)}
    .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:2px 0 6px}
    .legend i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px}
    .twrap{overflow-x:auto}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
    td{padding:7px 10px;border-bottom:1px solid var(--grid);white-space:nowrap}
    td.num,th.num{text-align:right}
    tbody tr[data-game]{cursor:pointer}
    .bars{display:flex;height:14px;border-radius:4px;overflow:hidden;gap:2px}
    .kv{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);padding:3px 0}
    .kv b{color:var(--ink);font-weight:500;font-family:"Fira Mono",ui-monospace,Consolas,monospace}
    pre{background:var(--chip);border-radius:6px;padding:10px;font-size:12px;overflow-x:auto;font-family:"Fira Mono",ui-monospace,Consolas,monospace;color:var(--muted)}
    canvas{max-width:100%}
    a{color:var(--s1)}
  </style>
</head>
<body>
<header>
  <strong>Game on Paper <span style="color:var(--muted)">/ admin</span></strong>
  <span style="margin-left:auto;color:var(--muted);font-size:12px" id="asof"></span>
</header>
<nav id="tabs">
  <button data-t="overview" class="on">Overview</button>
  <button data-t="games">Live games</button>
  <button data-t="upstream">ESPN / upstream</button>
  <button data-t="errors">Errors</button>
  <button data-t="traffic">Traffic</button>
  <button data-t="system">System</button>
</nav>
<main>
  <section id="overview" class="on">
    <div class="tiles" id="ov-tiles"></div>
    <h2>Last 60 minutes</h2>
    <div class="grid2">
      <div class="card"><h2 style="margin-top:0">Requests / min (astro)</h2><canvas id="c-reqs" height="150"></canvas></div>
      <div class="card"><h2 style="margin-top:0">Status mix · 1h</h2><div class="bars" id="statusbars"></div><div class="legend" id="statuslegend"></div><div id="ov-services"></div></div>
    </div>
    <div class="card" style="margin-top:10px"><h2 style="margin-top:0">Latency percentiles (ms)</h2><canvas id="c-pct" height="150"></canvas></div>
  </section>
  <section id="games">
    <h2>Games with activity · last 30 min (click a row for page detail)</h2>
    <div class="card twrap"><table id="t-games"></table></div>
    <div id="page-detail"></div>
  </section>
  <section id="upstream">
    <h2>Per-target health · 24h</h2>
    <div class="card twrap"><table id="t-targets"></table></div>
    <h2>Failures per hour · 24h</h2>
    <div class="card"><canvas id="c-fail" height="140"></canvas></div>
    <h2>Slowest calls · last hour</h2>
    <div class="card twrap"><table id="t-slowest"></table></div>
  </section>
  <section id="errors">
    <h2>Grouped by signature · 24h</h2>
    <div class="card twrap"><table id="t-errgroups"></table></div>
    <h2>Most recent</h2>
    <div id="err-recent"></div>
  </section>
  <section id="traffic">
    <div class="card"><p style="color:var(--muted);margin:0">Visitor analytics live in
      <a href="https://plausible.io/gameonpaper.com">Plausible → gameonpaper.com</a>.
      Below is ops traffic from request_log (IPs shown here only).</p></div>
    <div class="grid2eq" style="margin-top:10px">
      <div class="card twrap"><h2 style="margin-top:0">Top routes · 1h</h2><table id="t-routes"></table></div>
      <div class="card twrap"><h2 style="margin-top:0">Top IPs · 1h</h2><table id="t-ips"></table></div>
    </div>
    <div class="card" style="margin-top:10px"><h2 style="margin-top:0">Web vitals p75 · 24h</h2><div id="t-vitals"></div></div>
  </section>
  <section id="system">
    <h2>Python RSS (MB) + CPU · 6h <span style="text-transform:none;letter-spacing:0">(Astro runs on Workers — no process stats)</span></h2>
    <div class="card"><canvas id="c-mem" height="150"></canvas></div>
  </section>
</main>
<script>
  import Chart from 'chart.js/auto';

  const S = ['#4d8df0', '#c97a20', '#1d9e7c', '#a95cc6'];
  const STATUS = { good: '#3fae72', warn: '#d9a441', crit: '#e05561' };
  const charts = {};
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (x, d = 0) => (x == null ? '—' : Number(x).toFixed(d));
  const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
  const api = (name, qs = '') => fetch(`/admin/api/${name}${qs}`).then((r) => r.json());

  function line(id, labels, datasets) {
    charts[id]?.destroy();
    charts[id] = new Chart(document.getElementById(id), {
      type: 'line',
      data: { labels, datasets: datasets.map((d, i) => ({ ...d, borderColor: d.borderColor ?? S[i % 4], backgroundColor: 'transparent', pointRadius: 0, borderWidth: 2, tension: 0.25 })) },
      options: { animation: false, plugins: { legend: { labels: { color: '#98a1ad' } } },
        scales: { x: { ticks: { color: '#6b7480', maxTicksLimit: 8 }, grid: { color: '#232933' } },
                  y: { ticks: { color: '#6b7480' }, grid: { color: '#232933' }, beginAtZero: true } } },
    });
  }
  function table(el, head, rows) {
    document.getElementById(el).innerHTML =
      '<thead><tr>' + head.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead>' +
      '<tbody>' + rows.map((r) => `<tr${r.attr ?? ''}>` + r.cells.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('') + '</tr>').join('') + '</tbody>';
  }
  function segbar(el, legEl, parts) {
    const total = parts.reduce((a, p) => a + p.v, 0) || 1;
    document.getElementById(el).innerHTML = parts.map((p) => `<div style="flex:${Math.max(p.v, 0.001)};background:${p.c}" title="${p.n}: ${p.v}"></div>`).join('');
    document.getElementById(legEl).innerHTML = parts.map((p) => `<span><i style="background:${p.c}"></i>${p.n} ${(100 * p.v / total).toFixed(1)}%</span>`).join('');
  }

  async function refreshOverview() {
    const d = await api('overview');
    const total = d.statusMix.reduce((a, s) => a + s.n, 0) || 1;
    const errs = d.statusMix.filter((s) => s.klass === 5).reduce((a, s) => a + s.n, 0);
    const lastMin = d.reqPerMin.at(-1)?.n ?? 0;
    document.getElementById('ov-tiles').innerHTML =
      `<div class="tile"><span>Requests / min</span><b>${lastMin}</b></div>` +
      `<div class="tile"><span>HTTP 5xx rate 1h</span><b>${fmt(100 * errs / total, 2)} %</b></div>` +
      `<div class="tile"><span>ESPN success 1h</span><b>${d.espn.total ? fmt(100 * d.espn.oks / d.espn.total, 1) + ' %' : '—'}</b></div>` +
      `<div class="tile"><span>Telemetry buffered / dropped</span><b>${d.telemetry.buffered} / ${d.telemetry.dropped}</b></div>`;
    line('c-reqs', d.reqPerMin.map((r) => hhmm(r.m)), [{ label: 'req/min', data: d.reqPerMin.map((r) => r.n) }]);
    line('c-pct', d.pct.map((r) => hhmm(r.b)), [
      { label: 'p50', data: d.pct.map((r) => Math.round(r.p50)) },
      { label: 'p95', data: d.pct.map((r) => Math.round(r.p95)) },
      { label: 'p99', data: d.pct.map((r) => Math.round(r.p99)) }]);
    segbar('statusbars', 'statuslegend', d.statusMix.map((s, i) => ({ n: s.klass + 'xx', v: s.n, c: S[i % 4] })));
    document.getElementById('ov-services').innerHTML = d.services.map((s) => {
      const fresh = Date.now() - new Date(s.ts).getTime() < 90000;
      return `<div class="kv"><span><span class="pill ${fresh ? 'good' : 'crit'}">${fresh ? 'up' : 'stale'}</span> ${esc(s.service)}</span><b>rss ${fmt(s.rss_mb)} MB · cpu ${fmt(s.cpu_pct)}%</b></div>`;
    }).join('');
    document.getElementById('asof').textContent = new Date().toLocaleTimeString() + ' · refresh 15s';
  }

  async function refreshGames() {
    const d = await api('games');
    const fetchBy = Object.fromEntries(d.lastFetch.map((f) => [f.game_id, f]));
    table('t-games', ['Game ID', 'Req 30m', 'p95 ms', 'Cache hit', 'Degraded', 'Failed', 'Last ESPN fetch'],
      d.gamesAgg.map((g) => ({ attr: ` data-game="${esc(g.game_id)}"`, cells: [
        `<span class="mono">${esc(g.game_id)}</span>`, g.req_30m, fmt(g.p95_ms),
        g.cache_hit == null ? '—' : fmt(100 * g.cache_hit) + '%', g.degraded, g.failed,
        fetchBy[g.game_id] ? `<span class="mono">${fetchBy[g.game_id].status ?? 'ERR'} · ${fmt(fetchBy[g.game_id].duration_ms)} ms</span>` : '—'] })));
    document.querySelectorAll('#t-games tbody tr[data-game]').forEach((tr) =>
      tr.addEventListener('click', () => loadPageDetail(tr.dataset.game)));
  }

  async function loadPageDetail(gameId) {
    const d = await api('page', `?game_id=${encodeURIComponent(gameId)}`);
    const oc = { ok: 0, degraded: 0, failed: 0 };
    d.outcomes.forEach((o) => { oc[o.outcome] = o.n; });
    const latest = d.latest;
    document.getElementById('page-detail').innerHTML =
      `<h2>Page detail · game ${esc(gameId)}</h2><div class="card">` +
      `<div style="display:flex;justify-content:space-between;margin-bottom:8px"><b class="mono">game_id ${esc(gameId)}</b>` +
      (latest ? `<span class="pill ${latest.render_outcome === 'failed' ? 'crit' : 'warn'}">${latest.render_outcome}${latest.render_outcome === 'degraded' ? ' · salvageable' : ''}</span>` : '<span class="pill good">ok</span>') + '</div>' +
      `<div class="bars" id="pd-bars"></div><div class="legend" id="pd-legend"></div>` +
      `<h2>Missing datasets · 24h</h2>` + (d.missing.length
        ? d.missing.map((m) => `<div class="kv"><span class="mono">${esc(m.dataset)}</span><b>${m.n} renders</b></div>`).join('')
        : '<p style="color:var(--muted)">none</p>') +
      `<h2>Related errors · 24h</h2>` + (d.errors.length
        ? d.errors.map((e) => `<div class="kv"><span>${esc(e.message).slice(0, 90)}</span><b>${hhmm(e.ts)}</b></div>`).join('')
        : '<p style="color:var(--muted)">none</p>') + '</div>';
    segbar('pd-bars', 'pd-legend', [
      { n: 'ok', v: oc.ok, c: STATUS.good }, { n: 'degraded', v: oc.degraded, c: STATUS.warn },
      { n: 'failed', v: oc.failed, c: STATUS.crit }]);
  }

  async function refreshUpstream() {
    const d = await api('upstream');
    table('t-targets', ['Target', 'p50 ms', 'p95 ms', 'Success 24h', 'Calls'],
      d.targets.map((t) => ({ cells: [`<span class="mono">${esc(t.target)}</span>`, fmt(t.p50), fmt(t.p95), t.success == null ? '—' : fmt(100 * t.success, 2) + '%', t.total] })));
    line('c-fail', d.failures.map((f) => hhmm(f.h)), [
      { label: '5xx', data: d.failures.map((f) => f.s5xx), borderColor: S[1] },
      { label: 'timeout', data: d.failures.map((f) => f.timeouts), borderColor: S[3] }]);
    table('t-slowest', ['When', 'Target', 'Game', 'ms', 'Status'],
      d.slowest.map((s) => ({ cells: [`<span class="mono">${hhmm(s.ts)}</span>`, `<span class="mono">${esc(s.target)}</span>`, esc(s.game_id ?? '—'), fmt(s.duration_ms), s.status ?? '—'] })));
  }

  async function refreshErrors() {
    const d = await api('errors');
    table('t-errgroups', ['Signature', 'Service', 'Count', 'Last seen'],
      d.groups.map((g) => ({ cells: [esc(g.signature), esc(g.service), g.n, `<span class="mono">${hhmm(g.last_seen)}</span>`] })));
    document.getElementById('err-recent').innerHTML = d.recent.slice(0, 5).map((e) =>
      `<div class="card" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between"><span>[${esc(e.service)}] ${esc(e.message).slice(0, 120)}</span><b class="mono">${hhmm(e.ts)}</b></div>${e.stack ? `<pre>${esc(e.stack).slice(0, 1200)}</pre>` : ''}</div>`).join('');
  }

  async function refreshTraffic() {
    const d = await api('traffic');
    table('t-routes', ['Route', 'Req', 'p95 ms'], d.routes.map((r) => ({ cells: [`<span class="mono">${esc(r.route_pattern)}</span>`, r.n, fmt(r.p95)] })));
    table('t-ips', ['IP', 'Req', '4xx'], d.ips.map((r) => ({ cells: [`<span class="mono">${esc(r.ip)}</span>`, r.n, r.c4xx] })));
    document.getElementById('t-vitals').innerHTML = d.vitals.map((v) =>
      `<div class="kv"><span>${esc(v.name)}</span><b>${fmt(v.p75, v.name === 'CLS' ? 3 : 0)}${v.name === 'CLS' ? '' : ' ms'}</b></div>`).join('') || '<p style="color:var(--muted)">no vitals yet</p>';
  }

  async function refreshSystem() {
    const d = await api('system');
    const services = [...new Set(d.series.map((r) => r.service))];
    const labels = [...new Set(d.series.map((r) => r.m))].sort();
    line('c-mem', labels.map(hhmm), services.map((svc, i) => {
      const vals = Object.fromEntries(d.series.filter((r) => r.service === svc).map((r) => [r.m, r.rss_mb]));
      return { label: svc + ' rss', data: labels.map((l) => Math.round(vals[l] ?? 0)), borderColor: S[i % 4] };
    }));
  }

  const refreshers = { overview: refreshOverview, games: refreshGames, upstream: refreshUpstream, errors: refreshErrors, traffic: refreshTraffic, system: refreshSystem };
  let active = 'overview';
  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    active = b.dataset.t;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('main section').forEach((s) => s.classList.toggle('on', s.id === active));
    refreshers[active]().catch(() => {});
  });
  refreshOverview().catch(() => {});
  setInterval(() => refreshers[active]().catch(() => {}), 15000);
</script>
</body>
</html>
```

(Astro bundles the `<script>` via Vite, so the bare `import Chart from 'chart.js/auto'` resolves from the existing dependency.)

- [ ] **Step 3: Build + commit**

Run: `cd astro && npm run build` — clean.

```bash
git add astro/src/pages/admin/index.astro astro/src/pages/admin/api/
git commit -m "feat(admin): /admin dashboard — six tabs + page drill-down over python gop endpoints"
```

---

### Task 9: Env plumbing + end-to-end smoke

**Files:**
- Create: `astro/.env.example`
- Create: `scripts/seed_gop.py`
- Modify: `docker-compose.yml` (python service), `docker-compose.do.yml` (python service)
- Modify: `README.md` (append section)

**Interfaces:**
- Consumes: everything above + the `gop-pg-test` container from Task 1 Step 6 (port 5499; roles `gop_writer`/`w`, `gop_reader`/`r`).
- Produces: verified end-to-end flow + documented env contract.

- [ ] **Step 1: Create `astro/.env.example`** (astro dev reads `.env`; Workers deploys use `wrangler secret put` for the same names)

```sh
# GOP telemetry + admin (copy to astro/.env for local dev; NEVER commit real values)
GOP_INGEST_KEY=devkey
ADMIN_USER=admin
ADMIN_PASS=CHANGEME
TELEMETRY_ENABLED=1
PYTHON_HTTP_URL=http://localhost:7000
SUMMARY_HTTP_URL=http://localhost:3000
```

- [ ] **Step 2: Compose env for python** — in BOTH `docker-compose.yml` and `docker-compose.do.yml`, add to the `python` service (create the `environment:` block if absent):

```yaml
    environment:
      GOP_PG_DSN: ${GOP_PG_DSN:-}
      GOP_PG_DSN_RO: ${GOP_PG_DSN_RO:-}
      GOP_INGEST_KEY: ${GOP_INGEST_KEY:-}
      TELEMETRY_ENABLED: ${TELEMETRY_ENABLED:-1}
```

Validate: `docker compose -f docker-compose.yml config -q && docker compose -f docker-compose.do.yml config -q && echo OK` → `OK` (unset-var warnings fine).

- [ ] **Step 3: Write `scripts/seed_gop.py`** (PEP-723 uv script, matching the existing `scripts/` pattern)

```python
# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""Seed local GOP telemetry via POST /gop/ingest so every admin tab has data.

Usage:  GOP_INGEST_KEY=devkey uv run scripts/seed_gop.py
Note: ts is server-assigned, so all rows land "now" — charts show a current
spike, which is fine for layout/endpoint verification.
"""
import os
import random

import requests

BASE = os.environ.get("PYTHON_HTTP_URL", "http://localhost:7000")
KEY = os.environ.get("GOP_INGEST_KEY", "devkey")
GAMES = ["401628599", "401628477", "401635525"]

events = []
for i in range(300):
    game = GAMES[i % 3]
    degraded, failed = i % 17 == 0, i % 41 == 0
    events.append({"table": "request_log", "row": {
        "service": "astro", "method": "GET", "path": f"/cfb/game/{game}",
        "route_pattern": "/cfb/game/[id]", "status": 500 if failed else 200,
        "duration_ms": 60 + random.random() * 900, "ip": f"98.144.20.{i % 250}",
        "ua": "Googlebot/2.1" if i % 5 == 0 else "Mozilla/5.0", "game_id": game,
        "cache_status": "miss" if i % 3 == 0 else "hit",
        "render_outcome": "failed" if failed else ("degraded" if degraded else "ok"),
        "missing_datasets": ["winprobability", "pickcenter"] if degraded else None,
    }})
    if i % 4 == 0:
        events.append({"table": "upstream_log", "row": {
            "service": "astro",
            "target": ["espn_pbp", "espn_scoreboard", "flask_process", "summary"][i % 4],
            "status": 502 if i % 37 == 0 else 200,
            "duration_ms": 40 + random.random() * 1200,
            "ok": i % 37 != 0, "game_id": game,
            "error": "Bad Gateway" if i % 37 == 0 else None,
        }})
for i in range(8):
    events.append({"table": "error_log", "row": {
        "service": "python" if i % 2 else "client", "level": "error",
        "message": "ESPN pbp 502 Bad Gateway" if i % 2 else "TypeError: null is not an object",
        "stack": "at GamePage.astro:31", "path": "/cfb/game/401628599", "game_id": "401628599",
    }})
    events.append({"table": "client_event", "row": {
        "type": "web_vital", "name": ["LCP", "CLS", "INP"][i % 3],
        "value": [2100, 0.04, 140][i % 3], "path": "/cfb/game/401628599",
        "game_id": "401628599", "ua": "Mozilla/5.0", "ip": "98.144.20.1",
    }})
for i in range(6):
    events.append({"table": "system_stat", "row": {"service": "python", "rss_mb": 900 + i * 10, "cpu_pct": 30.0}})

for chunk in range(0, len(events), 150):
    r = requests.post(f"{BASE}/gop/ingest", json={"events": events[chunk:chunk + 150]},
                      headers={"X-GOP-Key": KEY}, timeout=10)
    print(chunk, r.status_code, r.json())
print(f"seeded {len(events)} events (python flushes to PG within ~5s)")
```

- [ ] **Step 4: End-to-end smoke** (bash; `gop-pg-test` from Task 1 must be running)

```bash
cd "c:/Users/saiem/Documents/GitHub-Data/game-on-paper-dev/game-on-paper-app/python"
GOP_PG_DSN="postgresql://gop_writer:w@localhost:5499/sportsdataverse" \
GOP_PG_DSN_RO="postgresql://gop_reader:r@localhost:5499/sportsdataverse" \
GOP_INGEST_KEY=devkey TELEMETRY_ENABLED=1 \
uv run python app.py &
sleep 5

# auth gates
curl -s -o /dev/null -w "ingest-no-key: %{http_code}\n" -X POST http://localhost:7000/gop/ingest -d '{"events":[]}'   # 401
curl -s -o /dev/null -w "admin-no-key: %{http_code}\n" http://localhost:7000/gop/admin/overview                        # 401

# seed + verify rows land
cd .. && GOP_INGEST_KEY=devkey uv run scripts/seed_gop.py
sleep 7
docker exec gop-pg-test psql -U postgres -d sportsdataverse -c "SELECT count(*) FROM gop.request_log;"   # ~300
for ep in overview games upstream errors traffic system "page?game_id=401628599"; do
  echo "== $ep"; curl -s -H "X-GOP-Key: devkey" "http://localhost:7000/gop/admin/$ep" | head -c 250; echo
done
```

Expected: 401/401; seed prints 202s; count ≈ 300; each admin endpoint returns non-empty JSON.

Then the Astro side:

```bash
cd astro && cp .env.example .env   # edit ADMIN_PASS=dev
npm run dev &
sleep 8
curl -s -o /dev/null -w "admin-anon: %{http_code}\n" http://localhost:4321/admin                     # 401
curl -s -o /dev/null -w "admin-auth: %{http_code}\n" -u admin:dev http://localhost:4321/admin        # 200
curl -s -u admin:dev http://localhost:4321/admin/api/overview | head -c 200; echo
curl -s -o /dev/null -w "beacon: %{http_code}\n" -X POST http://localhost:4321/api/client-log \
  -H 'Content-Type: application/json' -d '{"type":"web_vital","name":"LCP","value":1234,"path":"/cfb/"}'  # 200
sleep 7
docker exec gop-pg-test psql -U postgres -d sportsdataverse -c "SELECT count(*) FROM gop.client_event;"   # grew by 1
```

Open `http://localhost:4321/admin` (admin/dev) and click through all six tabs + a game row's page detail — charts and tables render with seeded data. Load `http://localhost:4321/cfb/` and confirm astro request_log rows appear (`SELECT count(*) FROM gop.request_log WHERE service='astro' AND route_pattern NOT LIKE '/admin%';` grows).

- [ ] **Step 5: Append to `README.md`**

```markdown
## Admin observability

`/admin` (basic auth: `ADMIN_USER`/`ADMIN_PASS`, enforced in Astro middleware)
shows request latency, live-game processing health, ESPN upstream status, errors
(server + client), traffic, and system stats, with a per-page drill-down of
missing datasets (degraded vs failed renders). Telemetry flows: Astro middleware
and the client beacon POST events to python `/gop/ingest` (shared
`GOP_INGEST_KEY`); python batches everything into the `gop` schema on the
sdv-data Postgres (`GOP_PG_DSN` / `GOP_PG_DSN_RO`). All paths are fail-open —
if python or Postgres is down the site is unaffected. `TELEMETRY_ENABLED=0`
disables. Setup runbook: sdv-db `docs/gop-telemetry-runbook.md`. Local dev:
`astro/.env.example` + `scripts/seed_gop.py`. Visitor analytics: Plausible
Cloud (tag in `GenericPage.astro`).
```

- [ ] **Step 6: Full suites, cleanup, commit**

```bash
kill %1 %2 2>/dev/null
cd astro && npm test && cd ../python && uv run pytest tests/ -v && cd ..
git add astro/.env.example scripts/seed_gop.py docker-compose.yml docker-compose.do.yml README.md
git commit -m "chore(telemetry): env plumbing, local seed script, admin docs"
docker rm -f gop-pg-test   # optional; keep if iterating
```

---

## Deploy / rollout notes (owner-executed, after merge)

1. Apply the sdv-db runbook on sdv-data: schema, roles, pg_hba (python droplet IP), DO firewall, prune timer.
2. Droplet deploy: put `GOP_PG_DSN`, `GOP_PG_DSN_RO`, `GOP_INGEST_KEY` in the compose `.env`. Workers deploy: `cd astro && wrangler secret put GOP_INGEST_KEY ADMIN_USER ADMIN_PASS PYTHON_HTTP_URL` (PYTHON_HTTP_URL must be the python service's public URL when the Worker is off-droplet).
3. `TELEMETRY_ENABLED=0` is the kill switch on both sides; an unset DSN/key disables cleanly.
4. Plausible: nothing to do — `gameonpaper.com` tag already ships in the layout.
5. Verify: `/admin` 401s anonymously; authed Overview populates within ~1 minute; `SELECT count(*) FROM gop.request_log` grows; rotate `GOP_INGEST_KEY` + `ADMIN_PASS` together if either leaks.


