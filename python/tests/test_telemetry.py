import sys, pathlib, time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from telemetry import _TABLES, Telemetry, stage


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


def test_host_reporter_is_exclusive_and_sane():
    """Exactly one worker emits python-host rows, and the values are plausible.

    Guards the election: an earlier pid-based version elected nobody under
    gunicorn, because the arbiter owns pid 1 and never runs this loop.
    """
    import telemetry as tmod

    rows = []
    tel = tmod.Telemetry.__new__(tmod.Telemetry)
    tel._host_lock = None
    tel.push = lambda table, row: rows.append((table, row))
    assert tel._is_host_reporter() is True

    # a second "worker" (fresh state, same lock file) must not also report
    other = tmod.Telemetry.__new__(tmod.Telemetry)
    other._host_lock = None
    assert other._is_host_reporter() is False

    tel._sample_host()
    assert rows, "elected worker emitted nothing"
    table, row = rows[0]
    assert table == "system_stat"
    assert row["service"] == "python-host"
    assert row["heap_mb"] >= 1                      # core count
    assert row["cpu_pct"] is None or row["cpu_pct"] >= 0


class SchemaConn(FakeConn):
    """A connection whose gop.request_log is the pre-migration 15-column table.

    Postgres rejects an INSERT naming a column that does not exist, and
    ``flush`` drops the whole batch on any error -- so a telemetry column added
    ahead of its migration costs every row of that table, not just its own
    field. This is that database.
    """

    LIVE = {
        "request_log": [c for c in _TABLES["request_log"] if not c.startswith("qa_")],
        "upstream_log": list(_TABLES["upstream_log"]),
    }

    def __init__(self, log):
        super().__init__(log)
        self.rows = None

    def execute(self, sql, params=None):
        assert "information_schema.columns" in sql
        self.rows = [(t, c) for t, cols in self.LIVE.items() for c in cols]

    def fetchall(self):
        return self.rows

    def executemany(self, sql, rows):
        named = sql.split("(", 1)[1].split(")", 1)[0].split(",")
        unknown = [c for c in named if c not in self.LIVE.get(sql.split()[2].split(".")[1], [])]
        if unknown:
            raise RuntimeError(f'column "{unknown[0]}" of relation does not exist')
        self.log.append((sql, list(rows)))


def test_a_column_the_live_table_lacks_costs_only_that_column():
    log = []
    tel = Telemetry(enabled=True, conn_factory=lambda: SchemaConn(log))
    tel.push("request_log", {"service": "python", "path": "/cfb/1/process", "status": 200,
                             "duration_ms": 12.0, "qa_ok": False, "qa_errors": 2,
                             "qa_rules": ["score.monotone"]})
    out = tel.flush()
    assert out["written"] == 1 and out["dropped"] == 0
    sql, rows = log[0]
    assert "qa_ok" not in sql and "duration_ms" in sql
    assert len(rows[0]) == len(SchemaConn.LIVE["request_log"])


def test_the_probe_is_one_query_per_connection():
    log = []
    conns = []

    def factory():
        c = SchemaConn(log)
        conns.append(c)
        return c

    tel = Telemetry(enabled=True, conn_factory=factory)
    for _ in range(3):
        tel.push("request_log", {"service": "python", "status": 200})
        tel.flush()
    assert len(conns) == 1 and len(log) == 3


def test_a_probe_that_fails_falls_back_to_the_declared_columns():
    log = []

    class NoProbe(FakeConn):
        def execute(self, *a):
            raise RuntimeError("information_schema denied")

    tel = Telemetry(enabled=True, conn_factory=lambda: NoProbe(log))
    tel.push("upstream_log", {"target": "espn_pbp", "status": 200, "ok": True})
    assert tel.flush()["written"] == 1
    assert "qa" not in log[0][0]  # upstream_log has no qa columns either way
    assert log[0][0].count(",") == len(_TABLES["upstream_log"]) * 2 - 2
