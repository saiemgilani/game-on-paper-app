"""Paper Index: who won this game on paper?

One share per team in [0, 1] from six performance margins -- success rate,
explosive-play rate, scoring-opportunity conversion, average starting field
position, havoc, and turnovers -- squashed through an intercept-free logistic
so a dead-even game reads 50/50.

Weights are fitted by tools/fit_paper_index.py (intercept-free logistic,
P(home won), real finals from the released play-by-play; provenance and
holdout metrics in the fixture it writes). The oracle test replays real
holdout games through THIS module and asserts it reproduces the trainer's
shares -- train/serve parity comes from both sides calling team_inputs().
"""

from __future__ import annotations

import math
import pathlib

import polars as pl
import sportsdataverse

# Expected points of a drive start by own yardline, bundled with the sdv-py
# models (99 rows). Field position enters the model in POINTS, not yards.
_EP_TABLE = pl.read_parquet(
    pathlib.Path(sportsdataverse.__file__).parent
    / "cfb"
    / "models"
    / "cfb_field_position_ep.parquet"
)

# Fitted 2026-09-07 by tools/fit_paper_index.py on 2016-2023 finals
# (holdout 2024-2025: see the oracle fixture's provenance block).
WEIGHTS = {
    "success": 17.7470,
    "explosive": 19.5992,
    "opp_conversion": 3.8633,
    "field_position": 3.6399,
    "havoc": 5.2005,
    "turnovers": 0.5631,
}

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
}


def team_inputs(frame: pl.DataFrame, team_id) -> dict | None:
    """The six model inputs for one team's offense, from a plays frame.

    Works on both the live plays_frame and the released play-by-play (the
    trainer renames pos_team_id -> pos_team first): success rate, explosive
    rate, scoring-opportunity conversion (share of opportunity drives that
    scored), average drive-start yards to the end zone, havoc allowed (the
    opponent's havoc, created on this team's snaps), and turnovers committed.
    """
    if not isinstance(frame, pl.DataFrame) or frame.height == 0:
        return None
    if not _NEEDED.issubset(set(frame.columns)):
        return None
    mine = frame.filter(
        (pl.col("scrimmage_play") == True)  # noqa: E712
        & (pl.col("pos_team").cast(pl.Utf8) == str(team_id))
    )
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
    ep_starts = (
        drives.with_columns(
            yardline_own=(100 - pl.col("start_yte")).cast(pl.Int64).clip(1, 99)
        )
        .join(_EP_TABLE, on="yardline_own", how="left")
    )
    avg_start_ep = ep_starts["ep"].mean()
    if avg_start_ep is None:
        return None
    return {
        "successRate": float(
            mine.select((pl.col("EPA_success") == True).mean()).item()
        ),  # noqa: E712
        "explosiveRate": float(
            mine.select((pl.col("EPA_explosive") == True).mean()).item()
        ),  # noqa: E712
        # no opportunities is neutral finishing, not zero-percent finishing
        "oppConversion": (opp_converted / opp_trips) if opp_trips > 0 else 0.5,
        "avgStartYardsToEndzone": float(avg_start),
        "avgStartEp": float(avg_start_ep),
        "havocAllowedRate": float(mine.select((pl.col("havoc") == True).mean()).item()),  # noqa: E712
        "turnoversCommitted": float(
            mine.select((pl.col("is_pos_team_turnover") == True).sum()).item()  # noqa: E712
        ),
    }


def share_from_inputs(home: dict, away: dict) -> dict:
    """Margins + the logistic share, from two team_inputs() dicts."""
    margins = {
        "success": home["successRate"] - away["successRate"],
        "explosive": home["explosiveRate"] - away["explosiveRate"],
        "opp_conversion": home["oppConversion"] - away["oppConversion"],
        # field position in POINTS: EP of the average drive start (bundled
        # cfb_field_position_ep curve); higher is better, so home - away
        "field_position": home["avgStartEp"] - away["avgStartEp"],
        # havoc the HOME defense created = havoc allowed on away snaps
        "havoc": away["havocAllowedRate"] - home["havocAllowedRate"],
        "turnovers": away["turnoversCommitted"] - home["turnoversCommitted"],
    }
    z = sum(WEIGHTS[k] * margins[k] for k in WEIGHTS)
    return {"homeShare": 1.0 / (1.0 + math.exp(-z)), "margins": margins}


def by_period(frame: pl.DataFrame, home_id, away_id) -> dict:
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
        home = team_inputs(sliced, home_id)
        away = team_inputs(sliced, away_id)
        if home is None or away is None:
            continue
        if label not in out:  # multiple OT periods fold into one "ot" window
            out[label] = share_from_inputs(home, away)
    return out


def compute(frame: pl.DataFrame, home_id, away_id) -> dict | None:
    """-> the paperIndex response object, or None when inputs are unusable."""
    home = team_inputs(frame, home_id)
    away = team_inputs(frame, away_id)
    if home is None or away is None:
        return None
    out = share_from_inputs(home, away)
    out["teams"] = {str(home_id): home, str(away_id): away}
    try:
        out["byPeriod"] = by_period(frame, home_id, away_id)
    except Exception:  # the strip is garnish; the gauge must survive it
        out["byPeriod"] = {}
    return out
