import polars as pl

import situational_stats

HOME, AWAY = "10", "20"


def _frame():
    n = 10
    base = {
        "game_play_number": list(range(1, n + 1)),
        "scrimmage_play": [True] * n,
        "pos_team": [10, 10, 10, 10, 10, 10, 20, 20, 20, 20],
        "period": [1, 1, 2, 2, 3, 4, 1, 2, 3, 4],
        "down": [1, 3, 3, 4, 1, 2, 1, 3, 2, 1],
        "distance": [10, 2, 8, 1, 10, 5, 10, 5, 3, 10],
        "EPA": [0.5, 1.0, -0.5, 2.0, 0.2, -0.1, 0.3, -0.2, 0.1, 0.4],
        "EPA_success": [True, True, False, True, True, False, True, False, True, True],
        "pos_score_pts": [0, 0, 7, 0, 0, 3, 0, 0, 7, 0],
        "under_2": [False, False, True, False, False, False, False, True, False, False],
        "middle_8": [False, False, True, True, False, False, False, True, False, False],
        "rz_play": [False, False, True, True, False, False, False, False, True, False],
        "goal_to_go": [
            False,
            False,
            True,
            False,
            False,
            False,
            False,
            False,
            False,
            False,
        ],
        "scoring_opp": [
            False,
            False,
            True,
            True,
            False,
            True,
            False,
            False,
            True,
            False,
        ],
        "touchdown": [
            False,
            False,
            True,
            False,
            False,
            False,
            False,
            False,
            True,
            False,
        ],
        "fg_made": [
            False,
            False,
            False,
            False,
            False,
            True,
            False,
            False,
            False,
            False,
        ],
        "first_down_created": [
            True,
            True,
            False,
            True,
            False,
            False,
            True,
            False,
            True,
            False,
        ],
        "firstD_by_penalty": [False] * n,
        "rush": [True, True, False, True, True, False, True, False, True, False],
        "pass": [False, False, True, False, False, True, False, True, False, True],
        "sack": [False] * n,
        "completion": [
            False,
            False,
            True,
            False,
            False,
            False,
            False,
            True,
            False,
            False,
        ],
        "pass_oe": [None, None, 5.0, None, None, -3.0, None, 2.0, None, 1.0],
        "line_yards": [3.0, 2.0, None, 4.5, 1.0, None, 2.0, None, 5.0, None],
        "second_level_yards": [1.0, 0.0, None, 2.0, 0.0, None, 0.0, None, 3.0, None],
        "open_field_yards": [0.0, 0.0, None, 10.0, 0.0, None, 0.0, None, 8.0, None],
        "stuffed_run": [
            False,
            False,
            False,
            False,
            True,
            False,
            False,
            False,
            False,
            False,
        ],
        "opportunity_run": [
            True,
            False,
            False,
            True,
            False,
            False,
            False,
            False,
            True,
            False,
        ],
        "power_rush_attempt": [
            False,
            True,
            False,
            True,
            False,
            False,
            False,
            False,
            False,
            False,
        ],
        "power_rush_success": [
            False,
            True,
            False,
            True,
            False,
            False,
            False,
            False,
            False,
            False,
        ],
        "short_rush_attempt": [
            False,
            True,
            False,
            True,
            False,
            False,
            False,
            False,
            False,
            False,
        ],
        "short_rush_success": [
            False,
            True,
            False,
            False,
            False,
            False,
            False,
            False,
            False,
            False,
        ],
        "air_yards": [None, None, 12.0, None, None, 22.0, None, 3.0, None, -2.0],
        "yards_after_catch": [None, None, 4.0, None, None, None, None, 6.0, None, None],
        "cpoe": [None, None, 10.0, None, None, -5.0, None, 3.0, None, 1.0],
        "fourth_down_recommendation": [
            None,
            None,
            None,
            "go",
            None,
            None,
            None,
            None,
            None,
            None,
        ],
        "punt_play": [False] * n,
        "fg_attempt": [
            False,
            False,
            False,
            False,
            False,
            True,
            False,
            False,
            False,
            False,
        ],
        "xp_attempt": [False] * n,
        "go_boost": [None, None, None, 2.5, None, None, None, None, None, None],
        "pos_score_diff": [0, 0, 0, 7, 7, 7, 0, -7, -7, 0],
        "penalty_flag": [
            False,
            False,
            False,
            False,
            False,
            False,
            False,
            False,
            False,
            True,
        ],
        "penalty_declined": [False] * n,
        "penalty_team_id": [None, None, None, None, None, None, None, None, None, 20],
        "penalty_1st_conv": [False] * n,
        "EPA_penalty": [None, None, None, None, None, None, None, None, None, -1.5],
        "havoc": [False, False, False, False, False, False, True, True, False, False],
        "TFL": [False, False, False, False, False, False, True, False, False, False],
        "pass_breakup": [
            False,
            False,
            False,
            False,
            False,
            False,
            False,
            True,
            False,
            False,
        ],
        "int": [False] * n,
        "is_pos_team_turnover": [
            False,
            False,
            False,
            False,
            False,
            False,
            False,
            True,
            False,
            False,
        ],
        "fumble_vec": [False] * n,
        "fumble_lost": [False] * n,
        "start.yardsToEndzone.touchback": [75, 55, 15, 10, 60, 30, 75, 45, 12, 85],
        "drive.id": ["a", "a", "b", "b", "c", "d", "e", "f", "g", "h"],
        "start.adj_TimeSecsRem": [
            3600.0,
            3580.0,
            1900.0,
            1875.0,
            1700.0,
            800.0,
            3400.0,
            1850.0,
            900.0,
            400.0,
        ],
    }
    return pl.DataFrame(base, strict=False)


def test_situational_sections_and_values():
    out = situational_stats.build(_frame(), HOME, AWAY)
    h = out["teams"][HOME]
    a = out["teams"][AWAY]

    # every section of the metrics note is present
    for key in (
        "two_minute",
        "middle_8",
        "red_zone",
        "goal_to_go",
        "finishing_drives",
        "downs",
        "rushing_quality",
        "passing_profile",
        "fourth_down_decisions",
        "score_state",
        "penalties_situational",
        "havoc_created",
        "turnovers",
        "field_zones",
        "pace",
        "non_garbage",
    ):
        assert key in h, key

    assert h["two_minute"] == {
        "plays": 1,
        "epa_play": -0.5,
        "success_rate": 0.0,
        "points": 7,
    }
    assert h["red_zone"]["trips"] == 1 and h["red_zone"]["td_trips"] == 1
    assert h["red_zone"]["points"] == 7
    assert h["finishing_drives"]["trips"] == 2 and h["finishing_drives"]["points"] == 10
    # play 3 is a 3rd-down TD: a TD counts as a conversion (book rule)
    assert h["downs"]["down_3"]["conversions"] == {"made": 2, "att": 2}
    assert h["downs"]["down_3"]["by_distance"]["short"] == {"made": 1, "att": 1}
    assert h["rushing_quality"]["power"] == {"made": 2, "att": 2}
    assert h["rushing_quality"]["short_yardage"] == {"made": 1, "att": 2}
    assert h["passing_profile"]["by_depth"]["medium"]["plays"] == 1
    # 4th down: recommendation 'go', they went -> agreement 1/1
    assert h["fourth_down_decisions"] == {
        "decisions": 1,
        "went_for_it": 1,
        "agreed_with_model": 1,
        "agreement_rate": 1.0,
        "go_wp_forgone": 0.0,
    }
    assert h["score_state"]["leading"]["plays"] == 3
    # away's accepted penalty with EPA swing
    assert a["penalties_situational"]["accepted"] == 1
    assert a["penalties_situational"]["epa_swing"] == -1.5
    # home's defense created the away havoc plays
    assert (
        h["havoc_created"]["front_seven"] == 1 and h["havoc_created"]["secondary"] == 1
    )
    assert a["turnovers"]["committed"] == 1 and a["turnovers"]["epa_swing"] == -0.2
    assert h["field_zones"]["red_zone"]["plays"] == 2
    # pace: only same-drive same-period consecutive deltas count
    assert h["pace"]["seconds_per_play"] is not None


def test_situational_fails_open():
    assert situational_stats.build(None, HOME, AWAY) is None
    assert situational_stats.build(pl.DataFrame(), HOME, AWAY) is None
    assert situational_stats.build(pl.DataFrame({"x": [1]}), HOME, AWAY) is None


def test_windowed_build_drops_window_inherent_sections():
    expr = pl.col("period").is_in([1, 2])
    out = situational_stats.build(_frame(), HOME, AWAY, window_expr=expr)
    h = out["teams"][HOME]
    # windowable sections present and windowed
    assert h["downs"]["down_1"]["plays"] == 1  # only the Q1 first-down play
    assert h["red_zone"]["trips"] == 1
    # window-inherent sections absent
    for k in ("two_minute", "middle_8", "pace", "non_garbage", "fourth_down_decisions"):
        assert k not in h, k


def test_windowed_build_empty_window_is_none():
    assert situational_stats.build(_frame(), HOME, AWAY, window_expr=pl.col("period") > 90) is None
