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

import paper_index

FIXTURE = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "paper_index_oracle.json").read_text()
)


def _frame():
    # two teams, three drives; team 10 sustains + finishes, team 20 stalls
    return pl.DataFrame(
        {
            "scrimmage_play": [True] * 8,
            "pos_team": [10, 10, 10, 10, 20, 20, 20, 20],
            "EPA_success": [True, True, True, False, True, False, False, False],
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
    assert ti == {
        "successRate": 0.75,
        "explosiveRate": 0.25,
        "oppConversion": 1.0,  # one opportunity drive (a), it scored
        "avgStartYardsToEndzone": 77.5,  # drive starts: a=75, b=80
        "havocAllowedRate": 0.0,
        "turnoversCommitted": 1.0,
    }
    ti20 = paper_index.team_inputs(_frame(), 20)
    assert ti20["oppConversion"] == 0.5  # no opportunities -> neutral
    assert ti20["havocAllowedRate"] == 0.5


def test_compute_share_and_symmetry():
    out = paper_index.compute(_frame(), 10, 20)
    assert out is not None and 0.5 < out["homeShare"] < 1.0
    flipped = paper_index.compute(_frame(), 20, 10)
    assert abs(out["homeShare"] + flipped["homeShare"] - 1.0) < 1e-12
    assert set(out["margins"]) == set(paper_index.WEIGHTS)


def test_fails_open():
    assert paper_index.compute(pl.DataFrame(), 10, 20) is None
    assert paper_index.compute(pl.DataFrame({"x": [1]}), 10, 20) is None
    assert paper_index.compute(_frame(), 999, 20) is None  # unknown team


def test_shipped_weights_match_fixture():
    """Never-lower/lineage gate: the committed WEIGHTS must be the trainer's
    output (4-decimal rounding documented in the module). Editing one without
    re-running tools/fit_paper_index.py fails here."""
    for k, v in FIXTURE["weights"].items():
        assert abs(paper_index.WEIGHTS[k] - v) < 5e-5, (k, paper_index.WEIGHTS[k], v)


def test_oracle_real_holdout_games():
    """The module reproduces the trainer's share for 12 real holdout games."""
    for g in FIXTURE["games"]:
        got = paper_index.share_from_inputs(g["home"], g["away"])["homeShare"]
        assert abs(got - g["expectedHomeShare"]) < 5e-4, (
            g["gameId"],
            got,
            g["expectedHomeShare"],
        )


def test_oracle_spans_the_range():
    shares = [g["expectedHomeShare"] for g in FIXTURE["games"]]
    assert min(shares) < 0.15 and max(shares) > 0.85
