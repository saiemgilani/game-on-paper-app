"""excitement.summary on the committed final games (real `/process` payloads, offline)."""

import copy

import pytest

import excitement


def test_lead_changes_counted_by_hand_cfb(processed):
    # CMU at OKST 2016, the scoring plays as ESPN lists them (away-home, the leader):
    # 0-7 OKST, 0-14 OKST, 7-14 OKST, 7-17 OKST, 10-17 OKST, 17-17 tied,
    # 17-20 OKST, 24-20 CMU (1), 24-27 OKST (2), 30-27 CMU (3).
    # The tie at 17 is not a lead, so OKST retaking it at 17-20 is no change.
    assert excitement.summary(processed("cfb"))["lead_changes"] == 3


def test_wire_to_wire_has_no_lead_change(processed):
    # JAX led CLE from 7-0 to 34-10 (nfl fixture): never tied after the first score.
    game = processed("nfl")
    scores = [
        (p["homeScore"], p["awayScore"]) for p in game["plays"] if p.get("scoringPlay")
    ]
    assert scores and all(h > a for h, a in scores)
    assert excitement.summary(game)["lead_changes"] == 0


@pytest.mark.parametrize("league", ["cfb", "nfl"])
def test_max_swing_is_the_largest_single_play_change(processed, league):
    game = processed(league)
    out = excitement.summary(game)
    biggest = max(abs(p["winProbability"]["added"]) for p in game["plays"])
    assert out["max_swing_pts"] == pytest.approx(100 * biggest)
    if league == "cfb":
        # the last-play touchdown that won it: 8% to 100% for CMU
        assert round(out["max_swing_pts"]) == 92


def _gei(game, final):
    """calculateGEI (astro/src/resources/python.ts) restated, the last play swinging to `final`."""
    plays = game["plays"]
    comp = game["header"]["competitions"][0]
    home = next(str(c["team"]["id"]) for c in comp["competitors"] if c["homeAway"] == "home")

    def home_wp(p):
        b = p["winProbability"]["before"]
        return b if str(p["pos_team"]) == home else 1 - b

    nxt = [home_wp(p) for p in plays[1:]] + [final]
    return 179.01777401608126 / len(plays) * sum(abs(n - home_wp(p)) for p, n in zip(plays, nxt))


@pytest.mark.parametrize("league", ["cfb", "nfl"])
def test_gei_is_the_page_formula(processed, league):
    game = processed(league)
    last = game["plays"][-1]
    final = 1.0 if last["homeScore"] > last["awayScore"] else 0.0  # no tie in either fixture
    assert excitement.summary(game)["gei"] == pytest.approx(_gei(game, final))


def test_last_play_swings_to_the_result_not_the_possession(processed):
    # CMU at OKST: CMU trailed 24-27 and had the ball on the last play, and won 30-27
    # on it. The home side (OKST) lost, so its WP ends at 0, whoever had the ball.
    game = processed("cfb")
    last = game["plays"][-1]
    comp = game["header"]["competitions"][0]
    away = next(str(c["team"]["id"]) for c in comp["competitors"] if c["homeAway"] == "away")
    assert str(last["pos_team"]) == away
    assert (last["start"]["awayScore"], last["start"]["homeScore"]) == (24, 27)
    assert (last["awayScore"], last["homeScore"]) == (30, 27)
    gei = excitement.summary(game)["gei"]
    assert gei == pytest.approx(_gei(game, 0.0))
    # the old rule read the side with the ball (CMU, leading after the play) as home's 1.0
    assert gei != pytest.approx(_gei(game, 1.0))


def test_a_tie_ends_at_even(processed):
    game = copy.deepcopy(processed("cfb"))
    game["plays"][-1]["awayScore"] = game["plays"][-1]["homeScore"]
    assert excitement.summary(game)["gei"] == pytest.approx(_gei(game, 0.5))


def test_live_game_sums_only_the_swings_so_far(processed):
    game = copy.deepcopy(processed("cfb"))
    game["header"]["competitions"][0]["status"]["type"]["completed"] = False
    game["plays"] = game["plays"][:60]
    out = excitement.summary(game)
    final = excitement.summary(processed("cfb"))
    assert 0 < out["gei"] < final["gei"]
    assert out["lead_changes"] == 0  # OKST led 14-7 by then


def test_no_plays():
    game = {
        "header": {
            "competitions": [
                {
                    "status": {"type": {}},
                    "competitors": [
                        {"homeAway": "home", "team": {"id": "1"}},
                        {"homeAway": "away", "team": {"id": "2"}},
                    ],
                }
            ]
        }
    }
    assert excitement.summary(game) == {
        "gei": None,
        "lead_changes": 0,
        "max_swing_pts": None,
    }
