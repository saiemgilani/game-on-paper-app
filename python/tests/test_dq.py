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


def test_dq_rows_pair_teams_and_compute_deltas():
    game = {
        "advBoxScore": {
            "team": [
                {
                    "pos_team": 2628,
                    "rushes": 30,
                    "rush_yards": 120,
                    "passes": 25,
                    "pass_yards": 210,
                    "penalties": 5,
                    "penalty_yards": -40,
                    "passing_first_downs_created": 8,
                    "rushing_first_downs_created": 6,
                },
            ],
            "espn_team": [
                {
                    "team_id": 2628,
                    "rushingAttempts": 30,
                    "rushingYards": 118,
                    "pass_attempts": 24,
                    "netPassingYards": 200,
                    "penalties": 5,
                    "penalty_yards": 40,
                    "firstDowns": 16,
                },
            ],
        },
        "plays": [
            {
                "scrimmage_play": True,
                "EPA": None,
                "wp_before": 0.5,
                "wp_after": 1.2,
                "EP_between": -4.0,
            },
            {
                "scrimmage_play": True,
                "EPA": 0.3,
                "wp_before": 0.6,
                "wp_after": 0.61,
                "EP_between": 0.0,
            },
        ],
    }
    rows = dq.build_dq_rows(game, 401856766, "0.1.3", "abc123")
    by = {(r["team_id"], r["stat"]): r for r in rows}
    assert by[(2628, "rush_yards")]["delta"] == 2.0
    assert by[(2628, "pass_attempts")]["delta"] == 1.0
    assert (
        by[(2628, "first_downs_created")]["ours"] == 14.0
        and by[(2628, "first_downs_created")]["delta"] == -2.0
    )
    assert by[(None, "lint:epa_null")]["delta"] == 1.0
    assert by[(None, "lint:wp_oob")]["delta"] == 1.0
    assert by[(None, "lint:ep_between_big")]["delta"] == 1.0
    assert by[(None, "plays")]["ours"] == 2.0
    assert all(r["sdv_py_sha"] == "abc123" for r in rows)


def test_dq_rows_skip_unmatched_teams():
    game = {"advBoxScore": {"team": [{"pos_team": 1}], "espn_team": []}, "plays": []}
    rows = dq.build_dq_rows(game, 5)
    assert all(r["stat"].startswith("lint:") or r["stat"] == "plays" for r in rows)
