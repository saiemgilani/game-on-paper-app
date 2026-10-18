# python/tests/test_basketball_route.py
"""The basketball processor routes come from BASKETBALL_PROCESSORS; the NBA's URL, endpoint and payload are unchanged."""
import base64
import gzip
import importlib
import json
import pathlib

FIX = pathlib.Path(__file__).parent / "fixtures" / "nba_summary_401585607.json.gz"
AUTH = {"Authorization": "Bearer " + base64.b64encode(b"secret").decode()}


class _Resp:
    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _summary():
    return json.loads(gzip.open(FIX, "rt", encoding="utf-8").read())


def _app(monkeypatch, summary, pushes=None):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    from sportsdataverse.nba import nba_pbp

    monkeypatch.setattr(nba_pbp, "download", lambda url, **kw: _Resp(json.loads(json.dumps(summary))))
    monkeypatch.setattr(app_mod.TEL, "push", (lambda k, r: pushes.append((k, r))) if pushes is not None else (lambda *a, **k: None))
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod


def test_one_rule_per_league_with_the_nba_rule_and_endpoint_unchanged(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    assert set(app_mod.BASKETBALL_PROCESSORS) == {"nba", "wnba"}
    rules = {r.rule: r.endpoint for r in app_mod.app.url_map.iter_rules()}
    for lg in app_mod.BASKETBALL_PROCESSORS:
        assert rules[f"/{lg}/<int(min=100000,max=999999999999):game_id>/process"] == f"process_{lg}"
    assert "/cfb/<int:game_id>/process" in rules and "/nfl/<int:game_id>/process" in rules


def test_nba_payload_carries_regulation_from_the_summary(monkeypatch):
    pushes = []
    app_mod = _app(monkeypatch, _summary(), pushes=pushes)
    r = app_mod.app.test_client().get("/nba/401585607/process", headers=AUTH)
    assert r.status_code == 200
    assert r.get_json()["regulation_periods"] == 4  # summary["format"]["regulation"]["periods"] in the real capture
    row = [row for kind, row in pushes if kind == "upstream_log"][-1]
    assert row["target"] == "espn_nba_pbp"


def test_regulation_is_null_when_the_summary_has_no_format(monkeypatch):
    summary = _summary()
    del summary["format"]
    app_mod = _app(monkeypatch, summary)
    body = app_mod.app.test_client().get("/nba/401585607/process", headers=AUTH).get_json()
    assert body["regulation_periods"] is None and body["periods"] == 4


def test_regulation_is_null_when_format_is_not_a_dict(monkeypatch):
    summary = _summary()
    summary["format"] = "4 quarters"  # labelled in-test mutation of the real capture: a non-dict `format`
    app_mod = _app(monkeypatch, summary)
    r = app_mod.app.test_client().get("/nba/401585607/process", headers=AUTH)
    assert r.status_code == 200
    assert r.get_json()["regulation_periods"] is None


def test_an_unmapped_league_has_no_route(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    assert app_mod.app.test_client().get("/xyz/401585607/process", headers=AUTH).status_code == 404
