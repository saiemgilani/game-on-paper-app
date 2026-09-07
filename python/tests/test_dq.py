import dq


def header(completed=True):
    return {
        "season": {"year": 2026},
        "week": 1,
        "competitions": [
            {
                "date": "2026-08-30T00:00Z",
                "status": {"type": {"name": "STATUS_FINAL", "completed": completed}},
                "competitors": [
                    {
                        "homeAway": "home",
                        "score": "10",
                        "team": {"abbreviation": "TCU"},
                    },
                    {
                        "homeAway": "away",
                        "score": "15",
                        "team": {"abbreviation": "UNC"},
                    },
                ],
            }
        ],
    }


def test_game_meta_row():
    r = dq.build_game_meta_row(header(), 401856766)
    assert r["game_id"] == 401856766 and r["season"] == 2026
    assert (r["away_abbr"], r["home_abbr"]) == ("UNC", "TCU")
    assert (r["away_score"], r["home_score"]) == (15.0, 10.0)
    assert r["status"] == "STATUS_FINAL" and r["kickoff_ts"] == "2026-08-30T00:00Z"


def test_game_meta_row_survives_empty_header():
    r = dq.build_game_meta_row({}, 1)
    assert r["game_id"] == 1 and r["away_abbr"] is None


def test_dq_rows_derive_official_conventions_from_plays():
    # One team, plays covering every convention: a rush; a sack (a RUSH
    # attempt officially, negative yardage); a completion; an incompletion
    # (no pass yards); a TD run without first_down_created (counts as a
    # first down officially); an accepted and a declined penalty.
    game = {
        "advBoxScore": {
            "team": [
                {
                    "pos_team": 2628,
                    "passing_first_downs_created": 8,
                    "rushing_first_downs_created": 6,
                    "penalty_first_downs_created": 1,
                },
            ],
            "espn_team": [
                {
                    "team_id": 2628,
                    "rushingAttempts": 3,
                    "rushingYards": 4,  # ours: 8 - 7 + 5 = 6 -> delta +2
                    "completionAttempts": "1/2",
                    "netPassingYards": 15,
                    "firstDowns": 16,  # ours: 8 + 6 + 1 + 1 TD = 16 -> delta 0
                    "penalties": 1,
                    "penalty_yards": 10,
                },
            ],
        },
        "plays": [
            {
                "pos_team": 2628,
                "rush": True,
                "statYardage": 8,
                "scrimmage_play": True,
                "EPA": None,
                "wp_before": 0.5,
                "wp_after": 1.2,
                "EP_between": -4.0,
            },
            {"pos_team": 2628, "pass": True, "sack": True, "yds_sacked": -7},
            {"pos_team": 2628, "pass": True, "completion": True, "statYardage": 15},
            {"pos_team": 2628, "pass": True, "completion": False, "statYardage": 0},
            {
                "pos_team": 2628,
                "rush": True,
                "statYardage": 5,
                "scrimmage_play": True,
                "touchdown": True,
                "first_down_created": False,
                "EPA": 3.1,
            },
            {"penalty_flag": True, "penalty_team_id": 2628, "yds_penalty": -10},
            {
                "penalty_flag": True,
                "penalty_declined": True,
                "penalty_team_id": 2628,
                "yds_penalty": 5,
            },
        ],
    }
    rows = dq.build_dq_rows(game, 401856766, "0.1.3", "abc123")
    by = {(r["team_id"], r["stat"]): r for r in rows}
    assert by[(2628, "rush_attempts")]["ours"] == 3.0  # sack included
    assert by[(2628, "rush_yards")]["delta"] == 2.0
    assert by[(2628, "pass_attempts")]["ours"] == 2.0  # sack excluded
    assert by[(2628, "pass_attempts")]["delta"] == 0.0
    assert by[(2628, "completions")]["delta"] == 0.0
    assert by[(2628, "pass_yards")]["ours"] == 15.0  # completions only
    assert by[(2628, "first_downs")]["ours"] == 16.0  # box counts + the TD
    assert by[(2628, "penalties")]["ours"] == 1.0  # declined not counted
    assert by[(2628, "penalty_yards")]["ours"] == 10.0  # accepted, absolute
    assert by[(None, "lint:epa_null")]["delta"] == 1.0
    assert by[(None, "lint:wp_oob")]["delta"] == 1.0
    assert by[(None, "lint:ep_between_big")]["delta"] == 1.0
    assert by[(None, "plays")]["ours"] == 7.0
    assert all(r["sdv_py_sha"] == "abc123" for r in rows)


def test_dq_rows_skip_unmatched_teams():
    game = {"advBoxScore": {"team": [{"pos_team": 1}], "espn_team": []}, "plays": []}
    rows = dq.build_dq_rows(game, 5)
    assert all(r["stat"].startswith("lint:") or r["stat"] == "plays" for r in rows)
