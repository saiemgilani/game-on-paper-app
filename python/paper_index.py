"""Paper Index: who won this game on paper?

One share per team in [0, 1] from eight performance margins in their
advanced-box forms -- success rate, explosive-play rate, explosiveness (EPA
per successful play), scoring-opportunity conversion rate, points per
opportunity, starting field position in expected points, havoc, and
turnovers -- squashed through an intercept-free logistic so a dead-even game
reads 50/50.

Weights are fitted PER LEAGUE by tools/fit_paper_index.py (intercept-free
logistic, P(home won), real finals from that league's released play-by-play;
provenance and holdout metrics in the fixture it writes:
tests/fixtures/paper_index_oracle.json for college,
paper_index_oracle_nfl.json for the NFL). The oracle tests replay real
holdout games through THIS module and assert it reproduces the trainer's
shares -- train/serve parity comes from both sides calling team_inputs().
The field-position margin is valued in POINTS with each league's own
EP-by-yardline curve bundled in sportsdataverse-py.
"""

from __future__ import annotations

import functools
import hashlib
import math
import pathlib

import polars as pl
import sportsdataverse


def _ep_table_path(league: str = "cfb") -> pathlib.Path:
    return (
        pathlib.Path(sportsdataverse.__file__).parent
        / league
        / "models"
        / f"{league}_field_position_ep.parquet"
    )


@functools.cache
def _ep_table(league: str = "cfb") -> pl.DataFrame:
    """Expected points of a drive start by own yardline (99 rows) for a league.

    Bundled with the sdv-py models (`cfb/models/cfb_field_position_ep.parquet`,
    `nfl/models/nfl_field_position_ep.parquet`); field position enters the
    model in POINTS, not yards. Read on first use, not at import: app.py
    imports this module at startup, and a missing parquet must not take the
    server down with it.
    """
    return pl.read_parquet(_ep_table_path(league))


FP_CURVE_ANCHORS = (1, 20, 50, 80, 99)


def ep_curve_fingerprint(league: str = "cfb") -> dict:
    """Identity of the field-position curve the weights were fitted against:
    the parquet's sha256 and its EP at five anchor yardlines. The trainer
    writes it into the oracle fixture and the tests assert it against the
    installed sportsdataverse, so an upstream refit of the curve (sdv-py
    floats on branch=main) fails loudly instead of quietly moving every
    served share -- the oracle's avgStartEp inputs are precomputed and would
    not notice on their own.
    """
    ep = dict(_ep_table(league).iter_rows())
    return {
        "sha256": hashlib.sha256(_ep_table_path(league).read_bytes()).hexdigest(),
        "points": {str(y): round(float(ep[y]), 6) for y in FP_CURVE_ANCHORS},
    }


# Fitted by tools/fit_paper_index.py on real finals of each league; the
# season split, gates, input identities and holdout metrics are in each
# oracle fixture's provenance block. A margin the active-set fit pinned to
# zero (it went negative under collinearity) ships as 0.0: it is an observed
# input, not a fitted one, so share_from_inputs() leaves it out of the
# margins it reports.
# cfb: fitted 2026-09-07, train 2016-2023 / holdout 2024-2025.
# nfl: fitted 2026-09-15, train 2016-2021 / holdout 2022-2025 (holdout
# widened for power after the 2024-25 holdout failed the paired EPA-only
# gate), on espn_nfl_pbp rebuilt with scoring_opp keyed to
# start.yardsToEndzone (sportsdataverse-py #495), made field goals counted
# in points per opportunity, Pro Bowls dropped.
WEIGHTS = {
    "cfb": {
        "success": 23.8447,
        "explosive": 2.8098,
        "explosive_epa": 3.2703,
        "opp_conversion": 3.4280,
        "pts_per_opp": 0.1860,
        "field_position": 4.0046,
        "havoc": 5.9958,
        "turnovers": 0.6005,
    },
    "nfl": {
        "success": 8.0168,
        "explosive": 1.3515,
        "explosive_epa": 1.7687,
        "opp_conversion": 1.9427,
        "pts_per_opp": 0.3468,
        "field_position": 2.5097,
        "havoc": 5.7830,
        "turnovers": 0.4545,
    },
}

# A league without its own fit gets no index rather than another league's
# weights wearing its name.
FITTED_LEAGUES = frozenset(WEIGHTS)

# league average points per scoring opportunity, train seasons only (the
# neutral value for a team with no opportunity trips); fitted constants,
# printed by the trainer alongside the weights
LEAGUE_PTS_PER_OPP = {"cfb": 3.3566, "nfl": 3.7257}

# Points per opportunity counts the points scored on scoring-opportunity
# snaps. A made field goal sits on a NON-scrimmage row in both leagues'
# play-by-play, so the scrimmage filter drops its three points. The NFL fit
# counts made field goals kicked from inside the 40 (fg_made rows flagged
# scoring_opp); the college weights were fitted without them, so flipping cfb
# here needs a refit first (the CFB oracle fixture would catch the drift).
OPP_POINTS_INCLUDE_FG = {"cfb": False, "nfl": True}

_NEEDED = {
    "scrimmage_play",
    "pos_team",
    "EPA_success",
    "EPA_explosive",
    "havoc",
    "scoring_opp",
    "drive.id",
    "drive.isScore",
    "start.yardsToEndzone",
    "is_pos_team_turnover",
    "EPA",
    "pos_score_pts",
}
_NEEDED_FG = {"fg_made"}


def opp_points_mask(league: str = "cfb") -> pl.Expr:
    """Rows whose pos_score_pts count toward points per opportunity.

    Shared by team_inputs() and the trainer so the feature is built one way
    on both sides: scrimmage snaps flagged scoring_opp, plus -- when the
    league's fit counts them (OPP_POINTS_INCLUDE_FG) -- made field goals
    flagged scoring_opp, which are non-scrimmage rows.
    """
    on_snap = pl.col("scrimmage_play") == True  # noqa: E712
    if OPP_POINTS_INCLUDE_FG[league]:
        on_snap = on_snap | (pl.col("fg_made") == True)  # noqa: E712
    return (pl.col("scoring_opp") == True) & on_snap  # noqa: E712


def _needed(league: str) -> set[str]:
    return _NEEDED | (_NEEDED_FG if OPP_POINTS_INCLUDE_FG[league] else set())


def team_inputs(frame: pl.DataFrame, team_id, league: str = "cfb") -> dict | None:
    """The model inputs for one team's offense, from a plays frame.

    Works on both the live plays_frame and the released play-by-play (the
    trainer renames pos_team_id -> pos_team first): success rate, explosive
    rate, explosiveness, scoring-opportunity conversion (share of opportunity
    drives that scored), points per opportunity, average drive-start yards to
    the end zone and its EP on the league's curve, havoc allowed (the
    opponent's havoc, created on this team's snaps), and turnovers committed.
    """
    if not isinstance(frame, pl.DataFrame) or frame.height == 0:
        return None
    if not _needed(league).issubset(set(frame.columns)):
        return None
    is_mine = pl.col("pos_team").cast(pl.Utf8) == str(team_id)
    mine = frame.filter((pl.col("scrimmage_play") == True) & is_mine)  # noqa: E712
    if mine.height == 0:
        return None
    drives = (
        mine.filter(pl.col("drive.id").is_not_null())
        .group_by("drive.id")
        .agg(
            opp=pl.col("scoring_opp").any(),
            scored=pl.col("drive.isScore").any(),
            start_yte=pl.col("start.yardsToEndzone").first(),
        )
    )
    opp_trips = int(drives.select(pl.col("opp").sum()).item()) if drives.height else 0
    opp_converted = (
        int(drives.select((pl.col("opp") & pl.col("scored")).sum()).item())
        if drives.height
        else 0
    )
    avg_start = drives["start_yte"].mean() if drives.height else None
    if avg_start is None:
        return None
    ep_starts = drives.with_columns(
        yardline_own=(100 - pl.col("start_yte")).cast(pl.Int64).clip(1, 99)
    ).join(_ep_table(league), on="yardline_own", how="left")
    avg_start_ep = ep_starts["ep"].mean()
    if avg_start_ep is None:
        return None
    succ = mine.filter(pl.col("EPA_success") == True)  # noqa: E712
    expl_epa = succ["EPA"].mean() if succ.height else None
    if expl_epa is None:
        return None  # a slice with zero successful plays has no explosiveness
    # from the whole frame, not the scrimmage slice: a made field goal is a
    # non-scrimmage row (see opp_points_mask)
    opp_points = float(
        frame.filter(is_mine & opp_points_mask(league))["pos_score_pts"].fill_null(0).sum()
    )
    return {
        "successRate": float(
            mine.select((pl.col("EPA_success") == True).mean()).item()
        ),  # noqa: E712
        "explosiveRate": float(
            mine.select((pl.col("EPA_explosive") == True).mean()).item()
        ),  # noqa: E712
        "explosivenessEpa": float(expl_epa),
        # no opportunities is neutral finishing, not zero-percent finishing
        "oppConversion": (opp_converted / opp_trips) if opp_trips > 0 else 0.5,
        "ptsPerOpp": (opp_points / opp_trips)
        if opp_trips > 0
        else LEAGUE_PTS_PER_OPP[league],
        "avgStartYardsToEndzone": float(avg_start),
        "avgStartEp": float(avg_start_ep),
        "havocAllowedRate": float(mine.select((pl.col("havoc") == True).mean()).item()),  # noqa: E712
        "turnoversCommitted": float(
            mine.select((pl.col("is_pos_team_turnover") == True).sum()).item()  # noqa: E712
        ),
    }


def share_from_inputs(home: dict, away: dict, league: str = "cfb") -> dict:
    """Margins + the logistic share, from two team_inputs() dicts.

    The returned margins are the league's FITTED inputs only (weight > 0)."""
    margins = {
        "success": home["successRate"] - away["successRate"],
        "explosive": home["explosiveRate"] - away["explosiveRate"],
        "explosive_epa": home["explosivenessEpa"] - away["explosivenessEpa"],
        "opp_conversion": home["oppConversion"] - away["oppConversion"],
        "pts_per_opp": home["ptsPerOpp"] - away["ptsPerOpp"],
        # field position in POINTS: EP of the average drive start (the
        # league's field_position_ep curve); higher is better, so home - away
        "field_position": home["avgStartEp"] - away["avgStartEp"],
        # havoc the HOME defense created = havoc allowed on away snaps
        "havoc": away["havocAllowedRate"] - home["havocAllowedRate"],
        "turnovers": away["turnoversCommitted"] - home["turnoversCommitted"],
    }
    weights = WEIGHTS[league]
    z = sum(weights[k] * margins[k] for k in weights)
    # only the fitted inputs: a margin pinned to zero at fit time carries no
    # weight in the share, so it is not reported as one of its factors
    fitted = {k: v for k, v in margins.items() if weights[k] > 0}
    return {"homeShare": 1.0 / (1.0 + math.exp(-z)), "margins": fitted}


def by_period(frame: pl.DataFrame, home_id, away_id, league: str = "cfb") -> dict:
    """Per-quarter (and OT) shares: the same fitted model applied to each
    window's plays -- who won EACH QUARTER on paper. Descriptive slices, so a
    window where either side has no snaps is simply omitted; margins that are
    per-game counts (turnovers) naturally shrink with the window."""
    if "period" not in frame.columns:
        return {}
    out = {}
    periods = sorted(
        p for p in frame["period"].unique().to_list() if p is not None and p >= 1
    )
    for p in periods:
        label = f"q{p}" if p <= 4 else "ot"
        sliced = frame.filter(
            pl.col("period") == p if p <= 4 else pl.col("period") >= 5
        )
        home = team_inputs(sliced, home_id, league)
        away = team_inputs(sliced, away_id, league)
        if home is None or away is None:
            continue
        if label not in out:  # multiple OT periods fold into one "ot" window
            out[label] = share_from_inputs(home, away, league)
    return out


def compute(frame: pl.DataFrame, home_id, away_id, league: str = "cfb") -> dict | None:
    """-> the paperIndex response object, or None when inputs are unusable or
    the league has no fitted weights (see FITTED_LEAGUES)."""
    if league not in FITTED_LEAGUES:
        return None
    home = team_inputs(frame, home_id, league)
    away = team_inputs(frame, away_id, league)
    if home is None or away is None:
        return None
    out = share_from_inputs(home, away, league)
    out["teams"] = {str(home_id): home, str(away_id): away}
    try:
        out["byPeriod"] = by_period(frame, home_id, away_id, league)
    except Exception:  # the strip is garnish; the gauge must survive it
        out["byPeriod"] = {}
    return out
