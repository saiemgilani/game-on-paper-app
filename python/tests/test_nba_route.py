import base64
import gzip
import importlib
import json
import math
import pathlib

import pytest

FIX = pathlib.Path(__file__).parent / "fixtures" / "nba_summary_401585607.json.gz"


class _Resp:
    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _client(monkeypatch, summary):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    from sportsdataverse.nba import nba_pbp

    monkeypatch.setattr(nba_pbp, "download", lambda url, **kw: _Resp(json.loads(json.dumps(summary))))
    monkeypatch.setattr(app_mod.TEL, "push", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod, app_mod.app.test_client()


@pytest.fixture
def client(monkeypatch):
    summary = json.loads(gzip.open(FIX, "rt", encoding="utf-8").read())
    return _client(monkeypatch, summary)[1]


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def test_nba_route_requires_token(client):
    assert client.get("/nba/401585607/process").status_code == 401


def test_nba_route_payload_shape(client):
    r = client.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 200
    body = r.get_json()
    assert body["gameId"] == 401585607 and body["source"] == "processor"
    assert body["prior"]["source"] == "hfa" and 0.5 < body["prior"]["home_win_prob"] < 0.6
    assert body["periods"] == 4 and body["status"]["completed"] is True
    assert body["teamInfo"]["home"]["id"] == "19" and body["teamInfo"]["away"]["id"] == "28"
    assert len(body["plays"]) == 450
    p = body["plays"][200]
    for k in ("id", "game_play_number", "period_number", "clock_display_value", "home_score", "away_score",
              "team_id", "text", "home_win_prob", "wp_delta", "wp_regime", "x_legacy", "y_legacy"):
        assert k in p, k
    assert all(not (isinstance(q["home_win_prob"], float) and math.isnan(q["home_win_prob"])) for q in body["plays"])
    assert set(body["teams"]) == {"home", "away"}
    home = body["teams"]["home"]
    assert home["team_id"] == 19 and "efg_pct" in home["rates"] and "field_goals_attempted" in home["box"]
    assert len(home["linescores"]) == 4
    players = body["players"]["home"] + body["players"]["away"]
    assert players and all("ts_pct" in q and "usg_pct" in q and "athlete_id" in q for q in players)
    dnp = [q for q in players if q["did_not_play"]]
    assert all(q["ts_pct"] is None and q["usg_pct"] is None for q in dnp)
    located = [q for q in body["plays"] if q["x_legacy"] is not None]
    assert len(located) > 100 and all(q["shooting_play"] for q in located)


def test_nba_final_play_resolves_win_probability(client):
    body = client.get("/nba/401585607/process", headers=auth()).get_json()
    assert body["plays"][-1]["home_win_prob"] in (0.0, 1.0)


def test_football_routes_kept_and_nba_is_separate(monkeypatch):
    summary = json.loads(gzip.open(FIX, "rt", encoding="utf-8").read())
    app_mod, _ = _client(monkeypatch, summary)
    rules = {r.rule: r.endpoint for r in app_mod.app.url_map.iter_rules()}
    assert "/cfb/<int:game_id>/process" in rules and "/nfl/<int:game_id>/process" in rules
    nba = rules["/nba/<int:game_id>/process"]
    assert nba not in (rules["/cfb/<int:game_id>/process"], rules["/nfl/<int:game_id>/process"])
    assert app_mod.app.view_functions[nba].__wrapped__ is not app_mod.process
    assert "nba" not in app_mod._PROCESSORS


def test_nba_malformed_espn_payload_is_404(monkeypatch):
    _, c = _client(monkeypatch, {})
    r = c.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 404
    assert r.get_json()["status"] == "bad"
