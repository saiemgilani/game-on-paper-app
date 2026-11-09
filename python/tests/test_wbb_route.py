"""/wbb/<id>/process: the women's college fetch and parse, sdv-py's game page with league="wbb", quarters and halves, D12."""
import base64
import gzip
import importlib
import json
import pathlib

import pytest

FIX = pathlib.Path(__file__).parent / "fixtures"
AUTH = {"Authorization": "Bearer " + base64.b64encode(b"secret").decode()}
SUMMARY = "http://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/summary?event={}"
# ESPN's linescores in the captures (home, away), re-printed by Task 2 Step 1
LINESCORES = {
    401805076: ([19, 18, 16, 26, 12], [23, 15, 15, 26, 8]),  # Louisiana Tech 91, UTEP 87: four quarters and one overtime
    401856459: ([18, 12, 21, 17], [11, 22, 7, 16]),  # Charleston 68, Hofstra 56 (neutral)
    400550784: ([16, 38], [30, 26]),  # UTEP 54, Rutgers 56 (halves)
    273130043: ([18, 26], [56, 44]),  # Yale 44, Stanford 100 (halves, 2007)
}


class _Resp:
    status_code = 200

    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _summary(gid):
    return json.loads(gzip.open(FIX / f"wbb_summary_{gid}.json.gz", "rt", encoding="utf-8").read())


def _app(monkeypatch, summary, calls=None, pushes=None):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    from sportsdataverse.wbb import wbb_pbp

    def fake_download(url, **kw):
        if calls is not None:
            calls.append(url)
        return _Resp(json.loads(json.dumps(summary)))

    monkeypatch.setattr(wbb_pbp, "download", fake_download)
    monkeypatch.setattr(app_mod.TEL, "push", (lambda k, r: pushes.append((k, r))) if pushes is not None else (lambda *a, **k: None))
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod


def _get(monkeypatch, gid, calls=None, pushes=None):
    app_mod = _app(monkeypatch, _summary(gid), calls, pushes)
    r = app_mod.app.test_client().get(f"/wbb/{gid}/process", headers=AUTH)
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()


def test_the_wbb_rule_sits_beside_the_others(monkeypatch):
    app_mod = _app(monkeypatch, _summary(401805076))
    assert app_mod.BASKETBALL_PROCESSORS["wbb"] == {
        "module": "sportsdataverse.wbb.wbb_pbp", "fetch": "espn_wbb_pbp", "helper": "helper_wbb_pbp", "frames_kwargs": {"league": "wbb"},
    }
    rules = {r.rule: r.endpoint for r in app_mod.app.url_map.iter_rules()}
    assert rules["/wbb/<int(min=100000,max=999999999999):game_id>/process"] == "process_wbb"
    for lg in ("nba", "wnba", "mbb"):
        assert rules[f"/{lg}/<int(min=100000,max=999999999999):game_id>/process"] == f"process_{lg}"
    assert app_mod.app.test_client().get("/wbb/401805076/process").status_code == 401


def test_a_quarters_overtime_game_is_four_quarters_and_a_fifth_period(monkeypatch):
    calls, pushes = [], []
    body = _get(monkeypatch, 401805076, calls, pushes)
    assert calls == [SUMMARY.format(401805076)]  # one ESPN call, the women's college one
    assert [row["target"] for kind, row in pushes if kind == "upstream_log"][-1] == "espn_wbb_pbp"
    assert (body["regulation_periods"], body["periods"]) == (4, 5)
    assert {p["wp_regime"] for p in body["plays"] if p["period_number"] == 5} == {"ot"}
    assert {p["wp_regime"] for p in body["plays"] if p["period_number"] <= 4} == {"reg"}
    assert [body["teams"][s]["rates"]["game_minutes"] for s in ("home", "away")] == [45, 45]  # 4 x 10 + one 5-minute OT
    assert (body["teams"]["home"]["linescores"], body["teams"]["away"]["linescores"]) == LINESCORES[401805076]
    assert body["prior"]["source"] == "hfa" and body["prior"]["game_spread_available"] is False  # no pickcenter, home court
    assert body["plays"][-1]["home_win_prob"] == 1.0  # Louisiana Tech won 91-87


def test_a_lineless_neutral_site_has_the_neutral_prior(monkeypatch):
    body = _get(monkeypatch, 401856459)
    assert body["prior"]["source"] == "neutral"
    assert body["prior"]["home_win_prob"] == pytest.approx(0.5)
    assert (body["regulation_periods"], body["periods"]) == (4, 4)
    assert (body["teams"]["home"]["linescores"], body["teams"]["away"]["linescores"]) == LINESCORES[401856459]
    assert body["plays"][-1]["home_win_prob"] == 1.0  # Charleston (home) won 68-56


def test_free_throws_carry_no_location(monkeypatch):
    body = _get(monkeypatch, 401805076)
    fts = [p for p in body["plays"] if "free throw" in p["text"].lower()]
    assert fts and all(p["x_legacy"] is None and p["y_legacy"] is None for p in fts)  # ESPN puts every one at (25, 0); plan #2 nulls them


def test_a_2014_halves_game_is_two_halves_with_the_rebuilt_final(monkeypatch):
    """ESPN's last two rows of 400550784 read 54-54 and 52-54 (plan #1); the processor serves the official 54-56."""
    body = _get(monkeypatch, 400550784)
    assert (body["regulation_periods"], body["periods"]) == (2, 2)
    assert [body["teams"][s]["rates"]["game_minutes"] for s in ("home", "away")] == [40, 40]
    assert (body["plays"][-1]["home_score"], body["plays"][-1]["away_score"]) == (54, 56)
    assert (body["teams"]["home"]["linescores"], body["teams"]["away"]["linescores"]) == LINESCORES[400550784]
    assert body["prior"]["source"] == "hfa"
    assert body["plays"][-1]["home_win_prob"] == 0.0  # UTEP (home) lost
    assert all(p["x_legacy"] is None for p in body["plays"])  # the 2014 summary has no coordinates


def test_before_2009_turnover_rates_are_null_not_zero(monkeypatch):
    """D12: ESPN's WBB box records no turnovers before 2009, so every rate that needs them is null."""
    body = _get(monkeypatch, 273130043)
    assert (body["regulation_periods"], body["periods"]) == (2, 2)
    for s in ("home", "away"):
        r = body["teams"][s]["rates"]
        assert [r["tov_pct"], r["possessions"], r["off_rtg"], r["def_rtg"], r["pace"], r["total_turnovers"]] == [None] * 6, s
        assert r["efg_pct"] is not None and r["game_minutes"] == 40  # what needs no turnovers is still there
        played = [p for p in body["players"][s] if not p.get("did_not_play")]
        assert played and all(p["usg_pct"] is None for p in played)
    assert (body["teams"]["home"]["linescores"], body["teams"]["away"]["linescores"]) == LINESCORES[273130043]
    assert body["plays"][-1]["home_win_prob"] == 0.0  # Yale (home) lost 44-100
