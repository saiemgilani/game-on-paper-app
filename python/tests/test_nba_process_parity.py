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


def test_nba_process_payload_is_unchanged(monkeypatch):
    kept = {k: v for k, v in _body(monkeypatch).items() if k not in ADDED_IN_PR0}
    if (
        not SNAP.exists()
    ):  # first run, on 81dbaf1e only: write it, commit it, never rewrite it in PR 0
        SNAP.write_text(
            json.dumps(kept, sort_keys=True, indent=1), encoding="utf-8", newline="\n"
        )
    assert kept == json.loads(SNAP.read_text(encoding="utf-8"))
