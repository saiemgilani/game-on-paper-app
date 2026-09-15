"""Paper Index: unit + real-game oracle tests.

The oracle fixture holds 12 real 2024-2025 holdout games (inputs aggregated
from the released play-by-play, expected shares computed by the trainer at
full weight precision). The shipped WEIGHTS are rounded to 4 decimals, so the
share tolerance is 5e-4 -- tight enough that a wrong sign, a dropped margin,
or an edited weight fails loudly, loose enough for the documented rounding.
"""

import json
import pathlib

import polars as pl
import pytest

import paper_index

_FIX_DIR = pathlib.Path(__file__).parent / "fixtures"
FIXTURES = {
    "cfb": json.loads((_FIX_DIR / "paper_index_oracle.json").read_text()),
    "nfl": json.loads((_FIX_DIR / "paper_index_oracle_nfl.json").read_text()),
}
FIXTURE = FIXTURES["cfb"]
LEAGUES = sorted(FIXTURES)


def _frame():
    # two teams, three drives; team 10 sustains + finishes, team 20 stalls
    return pl.DataFrame(
        {
            "scrimmage_play": [True] * 8,
            "pos_team": [10, 10, 10, 10, 20, 20, 20, 20],
            "EPA": [0.5, 1.5, 0.4, -0.3, 0.8, -0.2, -0.5, -0.1],
            "pos_score_pts": [0, 0, 7, 0, 0, 0, 0, 0],
            "EPA_success": [True, True, True, False, True, False, True, False],
            "EPA_explosive": [False, True, False, False, False, False, False, False],
            "havoc": [False, False, False, False, True, True, False, False],
            "scoring_opp": [False, True, True, False, False, False, False, False],
            "drive.id": ["a", "a", "a", "b", "c", "c", "d", "d"],
            "drive.isScore": [True, True, True, False, False, False, False, False],
            "start.yardsToEndzone": [75, 60, 40, 80, 60, 55, 90, 85],
            "is_pos_team_turnover": [
                False,
                False,
                False,
                True,
                False,
                False,
                False,
                False,
            ],
        },
        strict=False,
    )


def test_team_inputs_aggregation():
    ti = paper_index.team_inputs(_frame(), 10)
    # drive starts: a=75 yte (own 25), b=80 yte (own 20) -> EP from the
    # bundled curve, averaged
    ep = dict(paper_index._ep_table().iter_rows())
    expected_ep = (ep[25] + ep[20]) / 2
    assert abs(ti.pop("explosivenessEpa") - 0.8) < 1e-12  # mean of the 3 successes
    assert ti == {
        "successRate": 0.75,
        "explosiveRate": 0.25,
        "oppConversion": 1.0,  # one opportunity drive (a), it scored
        "ptsPerOpp": 7.0,  # 7 points on 1 opportunity trip
        "avgStartYardsToEndzone": 77.5,
        "avgStartEp": expected_ep,
        "havocAllowedRate": 0.0,
        "turnoversCommitted": 1.0,
    }
    ti20 = paper_index.team_inputs(_frame(), 20)
    assert ti20["oppConversion"] == 0.5  # no opportunities -> neutral
    assert ti20["ptsPerOpp"] == paper_index.LEAGUE_PTS_PER_OPP
    assert ti20["havocAllowedRate"] == 0.5


def test_compute_share_and_symmetry():
    out = paper_index.compute(_frame(), 10, 20)
    assert out is not None and 0.5 < out["homeShare"] < 1.0
    flipped = paper_index.compute(_frame(), 20, 10)
    assert abs(out["homeShare"] + flipped["homeShare"] - 1.0) < 1e-12
    assert set(out["margins"]) == set(paper_index.WEIGHTS)


def test_by_period_windows():
    f = _frame().with_columns(pl.Series("period", [1, 1, 2, 2, 1, 1, 2, 2]))
    out = paper_index.compute(f, 10, 20)
    assert set(out["byPeriod"]) == {"q1", "q2"}
    for w in out["byPeriod"].values():
        assert 0.0 < w["homeShare"] < 1.0
        assert set(w["margins"]) == set(paper_index.WEIGHTS)
    # a window where one side never snapped is omitted, not fabricated
    f2 = _frame().with_columns(pl.Series("period", [1, 1, 1, 1, 2, 2, 2, 2]))
    out2 = paper_index.compute(f2, 10, 20)
    assert out2["byPeriod"] == {}


def test_fails_open():
    assert paper_index.compute(pl.DataFrame(), 10, 20) is None
    assert paper_index.compute(pl.DataFrame({"x": [1]}), 10, 20) is None
    assert paper_index.compute(_frame(), 999, 20) is None  # unknown team


@pytest.mark.parametrize("league", LEAGUES)
def test_shipped_weights_match_fixture(league):
    """Never-lower/lineage gate: the committed WEIGHTS must be the trainer's
    output (4-decimal rounding documented in the module). Editing one without
    re-running tools/fit_paper_index.py fails here."""
    fx = FIXTURES[league]
    assert fx["provenance"].get("league", "cfb") == league
    for k, v in fx["weights"].items():
        assert abs(paper_index.WEIGHTS[league][k] - v) < 5e-5, (league, k, v)
    assert (
        abs(paper_index.LEAGUE_PTS_PER_OPP[league] - fx["provenance"]["league_pts_per_opp"])
        < 5e-5
    )
    assert league in paper_index.FITTED_LEAGUES
    assert all(w > 0 for w in paper_index.WEIGHTS[league].values())


@pytest.mark.parametrize("league", LEAGUES)
def test_oracle_real_holdout_games(league):
    """The module reproduces the trainer's share for 12 real holdout games."""
    for g in FIXTURES[league]["games"]:
        got = paper_index.share_from_inputs(g["home"], g["away"], league)["homeShare"]
        assert abs(got - g["expectedHomeShare"]) < 5e-4, (
            league,
            g["gameId"],
            got,
            g["expectedHomeShare"],
        )


@pytest.mark.parametrize("league", LEAGUES)
def test_oracle_spans_the_range(league):
    shares = [g["expectedHomeShare"] for g in FIXTURES[league]["games"]]
    assert min(shares) < 0.15 and max(shares) > 0.85


def test_each_league_values_field_position_on_its_own_curve():
    cfb = dict(paper_index._ep_table("cfb").iter_rows())
    nfl = dict(paper_index._ep_table("nfl").iter_rows())
    assert set(cfb) == set(nfl) == set(range(1, 100))
    assert nfl[50] != cfb[50]  # two fits, two curves
    assert nfl[99] > nfl[50] > nfl[1]
    # the same plays frame scores a different field-position input per league
    a = paper_index.team_inputs(_frame(), 10, "cfb")
    b = paper_index.team_inputs(_frame(), 10, "nfl")
    assert a["avgStartYardsToEndzone"] == b["avgStartYardsToEndzone"]
    assert a["avgStartEp"] != b["avgStartEp"]


def test_compute_is_none_for_a_league_without_a_fit():
    # the weights and the field-position EP curve are college fits; the NFL
    # frame now carries every input, but a college-weighted share must not
    # ship under an NFL game until an NFL fit lands
    assert paper_index.compute(_frame(), 10, 20, league="nfl") is None
    assert paper_index.compute(_frame(), 10, 20, league="cfb") is not None
    assert paper_index.compute(_frame(), 10, 20) is not None
