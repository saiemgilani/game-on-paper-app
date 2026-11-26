"""G16: the full-game box without garbage time (``advBoxScoreNonGarbage``).

The garbage-time line is sportsdataverse-py's ``flag_garbage_time``; these tests
pin the glue: which plays reach ``create_box_score``, when the key is absent, and
that the real college processor serves it through ``/cfb/<id>/process``.

The real game is 400869270 (OKST 27 at CMU 30, 2016; tests/fixtures), which is
never a 21-point game, so it has no garbage time: the key is absent. Lowering the
fourth-quarter line (the margin dict ``flag_garbage_time`` reads at call time)
makes its Q4 snaps garbage, and the box then loses exactly those plays.
"""

import polars as pl
from sportsdataverse.cfb.cfb_advanced_constants import GARBAGE_TIME_MARGIN

import span_box
from tests.test_usage_box_route import GAMES, PROCESSORS, _auth


class _Fake:
    def __init__(self, frame):
        self.plays_frame = frame

    def create_box_score(self, df):
        return {"periods": df["period"].to_list(), "columns": df.columns}


def _frame(margins):
    return pl.DataFrame(
        {
            "period": [1, 2, 3, 4, 5],
            "pos_team_score": margins,
            "def_pos_team_score": [0] * 5,
        }
    )


def test_garbage_plays_are_left_out_and_the_flag_column_is_not_passed_on():
    # Q2 by 38 (> 37) and OT by 22 (> 21) are garbage; Q1 by 43 (not > 43) and Q4 by 21 are not
    box = span_box.non_garbage_box(_Fake(_frame([43, 38, 0, 21, 22])))
    assert box["periods"] == [1, 3, 4]
    assert "garbage_time" not in box["columns"]


def test_no_garbage_time_or_no_plays_is_no_box():
    assert span_box.non_garbage_box(_Fake(_frame([43, 37, 27, 21, 21]))) is None
    assert span_box.non_garbage_box(_Fake(None)) is None


def _process(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import importlib

    import app as app_mod

    importlib.reload(app_mod)
    monkeypatch.setitem(app_mod._PROCESSORS, "cfb", PROCESSORS["cfb"])
    monkeypatch.setattr(app_mod.TEL, "push", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    r = app_mod.app.test_client().get(f"/cfb/{GAMES['cfb']}/process", headers=_auth())
    assert r.status_code == 200, r.get_data(as_text=True)[:300]
    return r.get_json()


def _team(box, team_id):
    return next(t for t in box["team"] if str(t["pos_team"]) == str(team_id))


def test_process_serves_no_box_for_a_game_without_garbage_time(processed):
    assert "advBoxScoreNonGarbage" not in processed("cfb")


def test_process_serves_the_full_box_minus_the_garbage_snaps(monkeypatch):
    monkeypatch.setitem(GARBAGE_TIME_MARGIN, 4, 0)
    body = _process(monkeypatch)
    # every Q4/OT snap with any margin is garbage now: the box is the full game minus those snaps
    clean, full = body["advBoxScoreNonGarbage"], body["advBoxScore"]
    teams = {
        str(c["team"]["id"]) for c in body["header"]["competitions"][0]["competitors"]
    }
    q4 = [
        p
        for p in body["plays"]
        if p["scrimmage_play"]
        and int(p["period"]) >= 4
        and p["pos_team_score"] != p["def_pos_team_score"]
    ]
    assert q4
    for tid in teams:
        lost = sum(
            1 for p in q4 if str(p["pos_team"]) == tid and not p.get("kneel_down")
        )
        assert (
            _team(full, tid)["scrimmage_plays"] - _team(clean, tid)["scrimmage_plays"]
            == lost
        )
    assert {"team", "situational", "defensive", "drives"} <= set(clean)
