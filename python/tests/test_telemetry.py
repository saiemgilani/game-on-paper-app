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
    tel.push(
        "upstream_log",
        {"target": "espn_pbp", "status": 200, "duration_ms": 12.5, "ok": True},
    )
    tel.push(
        "upstream_log",
        {"target": "espn_pbp", "status": 502, "duration_ms": 40.0, "ok": False},
    )
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


def test_push_signals_eager_flush_at_batch_rows():
    tel, _ = make(batch_rows=3)
    for i in range(2):
        tel.push("system_stat", {"rss_mb": i})
    assert not tel._wake.is_set()
    tel.push("system_stat", {"rss_mb": 2})
    assert tel._wake.is_set()


def test_concurrent_flush_failure_counts_all_drops():
    import threading as _t

    tel, _ = make(fail=True, batch_rows=1)
    tel.push("error_log", {"message": "a"})
    tel.push("error_log", {"message": "b"})
    threads = [_t.Thread(target=tel.flush) for _ in range(2)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    tel.flush()  # drain anything left
    assert tel.stats()["dropped"] == 2
