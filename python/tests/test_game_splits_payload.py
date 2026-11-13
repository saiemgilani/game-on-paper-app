"""BB-G32: /<league>/<id>/process carries sdv-py's BB-D31 game splits (counted possessions) for all four leagues."""
import base64
import gzip
import importlib
import json
import pathlib

import pytest

FIX = pathlib.Path(__file__).parent / "fixtures"
AUTH = {"Authorization": "Bearer " + base64.b64encode(b"secret").decode()}
# one real ESPN capture per league (fixtures/README.md); college counts run a little above the box estimate
# (0.44 under-counts one-and-one trips), the pros' a little below it (sdv-py #1156's gate bands)
GAMES = [("nba", 401585607, (0.93, 1.02)), ("wnba", 401736325, (0.93, 1.02)), ("mbb", 401820775, (0.97, 1.06)), ("wbb", 401805076, (0.97, 1.06))]


class _Resp:
    status_code = 200

    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _body(monkeypatch, league, gid):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    pbp = importlib.import_module(f"sportsdataverse.{league}.{league}_pbp")
    summary = json.loads(gzip.open(FIX / f"{league}_summary_{gid}.json.gz", "rt", encoding="utf-8").read())
    monkeypatch.setattr(pbp, "download", lambda url, **kw: _Resp(json.loads(json.dumps(summary))))
    monkeypatch.setattr(app_mod.TEL, "push", lambda *a, **k: None)
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    r = app_mod.app.test_client().get(f"/{league}/{gid}/process", headers=AUTH)
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


@pytest.mark.parametrize(("league", "gid", "band"), GAMES)
def test_each_side_carries_its_counted_splits(monkeypatch, league, gid, band):
    body = _body(monkeypatch, league, gid)
    for ha in ("home", "away"):
        team = body["teams"][ha]
        row = body["splits"][ha]["team"]
        assert row["team_id"] == team["team_id"]
        # the counted points are the box's, and the count sits in sdv-py's band around the box estimate
        assert row["points"] == team["box"]["team_score"]
        lo, hi = band
        assert lo <= row["possessions"] / team["rates"]["possessions"] <= hi
        players = body["splits"][ha]["players"]
        assert players and {p["team_id"] for p in players} == {team["team_id"]}
        assert sum(p["points"] for p in players) == row["points"]
