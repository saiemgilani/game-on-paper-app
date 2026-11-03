# python/tests/test_nba_process_parity.py
"""PR 0 gate: /nba/401585607/process returns the same JSON as on 81dbaf1e, plus the additive regulation_periods key."""

import base64
import gzip
import importlib
import json
import pathlib

FIX = pathlib.Path(__file__).parent / "fixtures"
SUMMARY = FIX / "nba_summary_401585607.json.gz"
SNAP = FIX / "nba_process_401585607.payload.json"
ADDED_IN_PR0 = {"regulation_periods"}


class _Resp:
    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _body(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    from sportsdataverse.nba import nba_pbp

    summary = json.loads(gzip.open(SUMMARY, "rt", encoding="utf-8").read())
    monkeypatch.setattr(
        nba_pbp, "download", lambda url, **kw: _Resp(json.loads(json.dumps(summary)))
    )
    monkeypatch.setattr(app_mod.TEL, "push", lambda *a, **k: None)
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    auth = {"Authorization": "Bearer " + base64.b64encode(b"secret").decode()}
    r = app_mod.app.test_client().get("/nba/401585607/process", headers=auth)
    assert r.status_code == 200
    return r.get_json()


def _no_line_as_snapshotted(body):
    """sportsdataverse-py #1044/#1045 stopped inventing a +2.5 home line for a game with no line.

    The snapshot predates that and carries 2.5; the payload now carries null. With
    game_spread_available false both mean "no line" (NbaGameHeader hides it, and the basketball
    win-probability chart never prints odds), so exactly that pair maps back and nothing else.
    """
    prior = body.get("prior") or {}
    if prior.get("game_spread_available") is False and prior.get("home_team_spread") is None:
        body["prior"] = {**prior, "home_team_spread": 2.5}
    return body


def test_nba_process_payload_is_unchanged(monkeypatch):
    kept = {k: v for k, v in _no_line_as_snapshotted(_body(monkeypatch)).items() if k not in ADDED_IN_PR0}
    assert SNAP.exists(), "PR 0 snapshot missing; never regenerate"
    assert kept == json.loads(SNAP.read_text(encoding="utf-8"))
