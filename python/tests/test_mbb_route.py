"""/mbb/<id>/process: the men's college fetch and parse, sdv-py's game page with league="mbb", halves, neutral sites."""
import base64
import gzip
import importlib
import json
import pathlib

import pytest

FIX = pathlib.Path(__file__).parent / "fixtures"
AUTH = {"Authorization": "Bearer " + base64.b64encode(b"secret").decode()}
SUMMARY = "http://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={}"
# ESPN's linescores in the captures (home, away), re-printed by Task 2 Step 1
LINESCORES = {
    401820775: ([38, 43, 15], [44, 37, 9]),  # Notre Dame 96, NC State 90: two halves and one overtime
    401744223: ([29, 32], [27, 37]),  # Texas State 61, Old Dominion 64
    401829457: ([30, 28], [41, 34]),  # North Dakota 58, Coastal Carolina 75
}


class _Resp:
    status_code = 200

    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _summary(gid):
    return json.loads(gzip.open(FIX / f"mbb_summary_{gid}.json.gz", "rt", encoding="utf-8").read())


def _app(monkeypatch, summary, calls=None, pushes=None):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    from sportsdataverse.mbb import mbb_pbp

    def fake_download(url, **kw):
        if calls is not None:
            calls.append(url)
        return _Resp(json.loads(json.dumps(summary)))

    monkeypatch.setattr(mbb_pbp, "download", fake_download)
    monkeypatch.setattr(app_mod.TEL, "push", (lambda k, r: pushes.append((k, r))) if pushes is not None else (lambda *a, **k: None))
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod


def _get(monkeypatch, gid, calls=None, pushes=None):
    app_mod = _app(monkeypatch, _summary(gid), calls, pushes)
    r = app_mod.app.test_client().get(f"/mbb/{gid}/process", headers=AUTH)
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


def test_the_mbb_rule_sits_beside_the_others(monkeypatch):
    app_mod = _app(monkeypatch, _summary(401820775))
    assert app_mod.BASKETBALL_PROCESSORS["mbb"] == {
        "module": "sportsdataverse.mbb.mbb_pbp", "fetch": "espn_mbb_pbp", "helper": "helper_mbb_pbp", "frames_kwargs": {"league": "mbb"},
    }
    rules = {r.rule: r.endpoint for r in app_mod.app.url_map.iter_rules()}
    assert rules["/mbb/<int(min=100000,max=999999999999):game_id>/process"] == "process_mbb"
    for lg in ("nba", "wnba"):
        assert rules[f"/{lg}/<int(min=100000,max=999999999999):game_id>/process"] == f"process_{lg}"
    assert app_mod.app.test_client().get("/mbb/401820775/process").status_code == 401


def test_an_overtime_game_is_two_halves_and_a_third_period(monkeypatch):
    calls, pushes = [], []
    body = _get(monkeypatch, 401820775, calls, pushes)
    assert calls == [SUMMARY.format(401820775)]  # one ESPN call, the men's college one
    assert [row["target"] for kind, row in pushes if kind == "upstream_log"][-1] == "espn_mbb_pbp"
    assert (body["regulation_periods"], body["periods"]) == (2, 3)
    assert {p["wp_regime"] for p in body["plays"] if p["period_number"] == 3} == {"ot"}
    assert {p["wp_regime"] for p in body["plays"] if p["period_number"] <= 2} == {"reg"}
    assert [body["teams"][s]["rates"]["game_minutes"] for s in ("home", "away")] == [45, 45]  # 2 x 20 + one 5-minute OT
    assert (body["teams"]["home"]["linescores"], body["teams"]["away"]["linescores"]) == LINESCORES[401820775]
    assert body["prior"]["source"] == "spread" and body["prior"]["game_spread_available"] is True  # ESPN's DraftKings line
    assert body["plays"][-1]["home_win_prob"] == 1.0  # Notre Dame won 96-90


def test_a_lineless_neutral_site_has_the_neutral_prior(monkeypatch):
    body = _get(monkeypatch, 401744223)
    assert body["prior"]["source"] == "neutral"
    assert body["prior"]["home_win_prob"] == pytest.approx(0.5)
    assert (body["regulation_periods"], body["periods"]) == (2, 2)
    assert (body["teams"]["home"]["linescores"], body["teams"]["away"]["linescores"]) == LINESCORES[401744223]
    assert body["plays"][-1]["home_win_prob"] == 0.0  # Texas State (home) lost 61-64


def test_free_throws_carry_no_location(monkeypatch):
    body = _get(monkeypatch, 401744223)
    fts = [p for p in body["plays"] if "free throw" in p["text"].lower()]
    assert fts and all(p["x_legacy"] is None and p["y_legacy"] is None for p in fts)  # ESPN puts every one at (25, 0); plan #2 nulls them


def test_the_swapped_neutral_site_score_is_repaired(monkeypatch):
    """ESPN's rows carry CCU's score in homeScore (plan #1); the processor serves the official sides."""
    body = _get(monkeypatch, 401829457)
    assert (body["plays"][-1]["home_score"], body["plays"][-1]["away_score"]) == (58, 75)
    first = next(p for p in body["plays"] if p["home_score"] + p["away_score"] > 0)
    assert (first["home_score"], first["away_score"]) == (3, 0)  # UND's opening three
    assert (body["teams"]["home"]["box"]["team_score"], body["teams"]["away"]["box"]["team_score"]) == (58, 75)
    assert body["prior"]["source"] == "neutral"
