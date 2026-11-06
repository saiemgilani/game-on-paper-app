"""/wnba/<id>/process: the WNBA fetch and parse, sdv-py's game page with league="wnba", two halves, a neutral site."""

import base64
import gzip
import importlib
import json
import pathlib

import pytest

FIX = pathlib.Path(__file__).parent / "fixtures"
AUTH = {"Authorization": "Bearer " + base64.b64encode(b"secret").decode()}
# ESPN's linescores in the two captures (home, away), captured 2026-10-18 (Task 2 Step 1)
LINESCORES = {
    250603003: (
        [18, 36, 14],
        [28, 26, 12],
    ),  # Detroit 68, New York 66: two halves and one overtime
    401736325: ([20, 14, 21, 23], [21, 19, 27, 13]),  # Atlanta 78, Seattle 80
}


class _Resp:
    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _summary(gid):
    return json.loads(
        gzip.open(FIX / f"wnba_summary_{gid}.json.gz", "rt", encoding="utf-8").read()
    )


def _app(monkeypatch, summary, calls=None, pushes=None):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    from sportsdataverse.wnba import wnba_pbp

    def fake_download(url, **kw):
        if calls is not None:
            calls.append(url)
        return _Resp(json.loads(json.dumps(summary)))

    monkeypatch.setattr(wnba_pbp, "download", fake_download)
    monkeypatch.setattr(
        app_mod.TEL,
        "push",
        (lambda k, r: pushes.append((k, r)))
        if pushes is not None
        else (lambda *a, **k: None),
    )
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod


def test_the_wnba_rule_sits_beside_the_nba_rule(monkeypatch):
    app_mod = _app(monkeypatch, _summary(250603003))
    assert app_mod.BASKETBALL_PROCESSORS["wnba"] == {
        "module": "sportsdataverse.wnba.wnba_pbp",
        "fetch": "espn_wnba_pbp",
        "helper": "helper_wnba_pbp",
        "frames_kwargs": {"league": "wnba"},
    }
    rules = {r.rule: r.endpoint for r in app_mod.app.url_map.iter_rules()}
    assert (
        rules["/wnba/<int(min=100000,max=999999999999):game_id>/process"]
        == "process_wnba"
    )
    assert (
        rules["/nba/<int(min=100000,max=999999999999):game_id>/process"]
        == "process_nba"
    )
    assert (
        app_mod.app.test_client().get("/wnba/250603003/process").status_code == 401
    )  # auth like every processor route


def test_a_2005_game_is_two_halves_and_one_overtime(monkeypatch):
    calls, pushes = [], []
    app_mod = _app(monkeypatch, _summary(250603003), calls, pushes)
    r = app_mod.app.test_client().get("/wnba/250603003/process", headers=AUTH)
    assert r.status_code == 200
    body = r.get_json()
    assert calls == [
        "http://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=250603003"
    ]  # one ESPN call, the WNBA one
    assert [row["target"] for kind, row in pushes if kind == "upstream_log"][
        -1
    ] == "espn_wnba_pbp"
    assert (body["regulation_periods"], body["periods"]) == (2, 3)
    assert {p["period_number"] for p in body["plays"]} == {1, 2, 3}
    assert {p["wp_regime"] for p in body["plays"] if p["period_number"] == 3} == {"ot"}
    assert {p["wp_regime"] for p in body["plays"] if p["period_number"] <= 2} == {"reg"}
    assert [body["teams"][s]["rates"]["game_minutes"] for s in ("home", "away")] == [
        45,
        45,
    ]  # 2 x 20 + one 5-minute OT
    assert (
        body["teams"]["home"]["linescores"],
        body["teams"]["away"]["linescores"],
    ) == LINESCORES[250603003]
    assert (
        body["prior"]["source"] == "hfa"
        and body["prior"]["game_spread_available"] is False
    )
    assert body["plays"][-1]["home_win_prob"] == 1.0  # Detroit won 68-66


def test_a_lineless_neutral_site_has_the_neutral_prior(monkeypatch):
    app_mod = _app(monkeypatch, _summary(401736325))
    body = (
        app_mod.app.test_client()
        .get("/wnba/401736325/process", headers=AUTH)
        .get_json()
    )
    assert body["prior"]["source"] == "neutral"
    assert body["prior"]["home_win_prob"] == pytest.approx(0.5)
    assert (body["regulation_periods"], body["periods"]) == (4, 4)
    assert (
        body["teams"]["home"]["linescores"],
        body["teams"]["away"]["linescores"],
    ) == LINESCORES[401736325]
    assert all(p["home_win_prob"] is not None for p in body["plays"])
    assert body["plays"][-1]["home_win_prob"] == 0.0  # Atlanta (home) lost 78-80
