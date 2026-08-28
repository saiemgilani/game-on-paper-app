"""Gunicorn config for the GOP processing API.

Sizing rationale (measured 2026-08-27 over 48h of production traffic):

  * A game process is ~7.5s of CPU-bound model work and only ~0.12s of ESPN
    I/O, so this is a CPU-bound service. Worker count should track CORES, not
    the 2*cores+1 rule of thumb, which assumes I/O-bound request handling.
  * `threads` buys almost nothing here -- the GIL serialises the model work and
    only the short fetch overlaps -- so the previous workers=4 x threads=2 was
    advertising 8 slots while delivering ~4. Peak observed concurrency was 29
    against those slots, which is why p99 reached 57s: it was queueing, not
    slowness.
  * Each worker resident set is ~600MB (sportsdataverse models load per
    process), so worker count is also memory-bound. Sizing off cores alone
    would OOM a small droplet.

Both limits are computed at boot so the same file is correct on a 2-core
droplet and on whatever it is resized to next. The chosen values are logged.
"""
import os

_MB = 1024 * 1024
WORKER_RSS_MB = 700          # measured ~600MB; leave headroom
MEM_FRACTION = 0.70          # never budget more than this share of RAM


def _cores():
    try:
        # respects cgroup cpu limits when present, unlike cpu_count()
        return max(1, len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        return max(1, os.cpu_count() or 1)


def _total_mem_mb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return float(line.split()[1]) / 1024.0
    except (OSError, ValueError):
        pass
    return None


def _pick_workers():
    cores = _cores()
    by_cpu = cores                      # CPU-bound: one busy worker per core
    mem = _total_mem_mb()
    by_mem = int((mem * MEM_FRACTION) // WORKER_RSS_MB) if mem else by_cpu
    return max(2, min(by_cpu, max(1, by_mem))), cores, mem, by_mem


workers, _cores_found, _mem_found, _by_mem = _pick_workers()

bind = "0.0.0.0:5000"
worker_class = "gthread"
threads = 2                  # overlaps the ~0.12s ESPN fetch only
timeout = 120
graceful_timeout = 30
# recycle workers periodically: the model stack leaks slowly and a fresh
# worker costs one cold request, not an outage. Jittered so they don't all
# recycle at once mid-drive.
max_requests = 400
max_requests_jitter = 80
accesslog = "-"
loglevel = "info"


def on_starting(server):
    server.log.info(
        "gop sizing: workers=%s (cores=%s, mem=%sMB -> mem allows %s), "
        "threads=%s, class=%s",
        workers, _cores_found,
        int(_mem_found) if _mem_found else "unknown",
        _by_mem, threads, worker_class,
    )
