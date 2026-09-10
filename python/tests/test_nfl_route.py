import base64
import importlib

import pytest


def _play(i, epa):
    return {
        "id": str(i),
        "text": f"play {i}",
        "EPA": epa,
        "clock.displayValue": "1:00",
        "clock.minutes": 1,
        "clock.seconds": 0,
        "type.id": "5",
        "type.text": "Rush",
        "type.abbreviation": "RUSH",
        "start.down": 1,
        "start.distance": 10,
        "start.yardsToEndzone": 75,
        "start.TimeSecsRem": 60,
        "start.adj_TimeSecsRem": 60,
        "pos_score_diff_start": 0,
        "start.posTeamTimeouts": 3,
        "start.defPosTeamTimeouts": 3,
        "start.ExpScoreDiff": 0.0,
        "start.ExpScoreDiff_Time_Ratio": 0.0,
        "start.spread_time": 0.0,
        "start.pos_team_receives_2H_kickoff": 0,
        "start.is_home": 1,
        "period": 1,
        "end.down": 2,
        "end.distance": 7,
        "end.yardsToEndzone": 72,
        "end.TimeSecsRem": 30,
        "end.adj_TimeSecsRem": 30,
        "end.posTeamTimeouts": 3,
        "end.defPosTeamTimeouts": 3,
        "end.ExpScoreDiff": 0.0,
        "end.ExpScoreDiff_Time_Ratio": 0.0,
        "end.spread_time": 0.0,
        "end.pos_team_receives_2H_kickoff": 0,
        "pos_score_diff_end": 0,
        "EP_start": 1.0,
        "EP_end": 1.0,
        "wp_before": 0.5,
        "wp_after": 0.5,
        "wpa": 0.0,
        "start.team.id": "1",
        "start.pos_team.id": "1",
        "start.pos_team.name": "A",
        "start.def_pos_team.id": "2",
        "start.def_pos_team.name": "B",
        "start.pos_team_score": 0,
        "start.def_pos_team_score": 0,
        "start.homeScore": 0,
        "start.awayScore": 0,
        "start.yardLine": 25,
        "start.pos_team_spread": 0.0,
        "start.downDistanceText": "1st & 10 at A 25",
        "end.team.id": "1",
        "end.pos_team.id": "1",
        "end.pos_team.name": "A",
        "end.def_pos_team.id": "2",
        "end.def_pos_team.name": "B",
        "end.pos_team_score": 0,
        "end.def_pos_team_score": 0,
        "end.homeScore": 0,
        "end.awayScore": 0,
        "end.yardLine": 28,
        "end.is_home": 1,
    }


class _FakeNFL:
    """Stands in for NFLPlayProcess: no network, three plays, one nan, no `success`."""

    def __init__(self, gameId=0, **_):
        self.gameId = gameId
        self.json = {
            "header": {"competitions": [{"status": {"type": {"completed": False}}}]}
        }
        self.plays_json = None
        self.fetched = False

    def espn_nfl_pbp(self):
        self.fetched = True

    def run_processing_pipeline(self):
        assert self.fetched, "pipeline ran before the ESPN fetch"
        return {
            "gameId": self.gameId,
            "plays": [_play(0, 0.4), _play(1, -0.2), _play(2, float("nan"))],
            "advBoxScore": {
                k: []
                for k in (
                    "pass",
                    "rush",
                    "receiver",
                    "team",
                    "situational",
                    "defensive",
                    "turnover",
                    "drives",
                )
            },
            "header": self.json["header"],
            "teamInfo": {},
            "drives": {},
            "season": {"year": 2025},
            "week": 10,
        }


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    monkeypatch.setitem(app_mod._PROCESSORS, "nfl", (_FakeNFL, "espn_nfl_pbp"))
    monkeypatch.setattr(app_mod.TEL, "push", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod.app.test_client()


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def test_nfl_route_requires_token(client):
    assert client.get("/nfl/401772944/process").status_code == 401


def test_nfl_route_processes_and_reshapes(client):
    r = client.get("/nfl/401772944/process", headers=auth())
    assert r.status_code == 200
    body = r.get_json()
    assert body["gameId"] == 401772944
    assert len(body["plays"]) == 3
    p = body["plays"][0]
    assert p["clock"]["displayValue"] == "1:00" and "clock.displayValue" not in p
    assert p["modelInputs"]["start"]["down"] == 1
    # the NFL processor has no `success`; the route derives it from EPA
    assert [q["success"] for q in body["plays"]] == [True, False, False]
    assert body["plays"][2]["EPA"] is None  # nan -> null
    assert set(body["advBoxScore"]) == {
        "pass",
        "rush",
        "receiver",
        "team",
        "situational",
        "defensive",
        "turnover",
        "drives",
    }


def test_cfb_route_still_registered(client):
    # the extraction must not have unregistered the original route
    assert client.get("/cfb/1/process").status_code == 401
