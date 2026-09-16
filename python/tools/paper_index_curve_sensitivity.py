"""How much of the Paper Index holdout score is the field-position curve's
holdout-era drives?

The bundled EP-by-yardline curve a league's weights are fitted against is
itself fitted on seasons that include the trainer's holdout (see
fit_paper_index.HOLDOUT_CONTAMINATION). This script refits that curve on the
league's TRAIN seasons only (the same sdv-py estimator that produced the
bundled artifact) and runs the trainer's build + fit + holdout scoring
(fit_paper_index.fit_and_evaluate) against it, both runs in scratch cache
directories that are discarded afterwards. It is a sensitivity probe, not a
retrain: it runs no parity check, applies no gates and writes no fixture.
It prints both holdout Briers side by side; paste the result into
fit_paper_index.CURVE_SENSITIVITY.

Run (from python/, needs a local pbp dir with the drive columns):
    .venv/bin/python tools/paper_index_curve_sensitivity.py --league nfl \\
        --pbp-dir /path/to/espn_nfl/pbp

Measured 2026-09-15 for the NFL on the 2016-21 / 2022-25 split: see
CURVE_SENSITIVITY in fit_paper_index.py.
"""

from __future__ import annotations

import argparse
import functools
import pathlib
import sys
import tempfile

import polars as pl

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import fit_paper_index as trainer  # noqa: E402
import paper_index  # noqa: E402

# college's bundled curve is fitted by dev/cfb_advanced/fit_field_position.py
# in sdv-py on 2018-2021 drives (no holdout overlap), so only the NFL needs
# this probe today
_CURVE_FITTERS = {
    "nfl": ("sportsdataverse.nfl.nfl_field_position", "fit_nfl_field_position_ep"),
}


def train_only_curve(league: str, pbp_dir: str, seasons: range) -> pl.DataFrame:
    import importlib

    mod, name = _CURVE_FITTERS[league]
    fitter = getattr(importlib.import_module(mod), name)
    from sportsdataverse.cfb.cfb_field_position import FP_PBP_COLS

    want = set(FP_PBP_COLS) | {
        "game_id",
        "season",
        "period",
        "homeTeamId",
        "drive.id",
        "drive.result",
        "drive.start.yardLine",
        "start.pos_team.id",
        "start.def_pos_team.id",
        "start.homeScore",
        "start.awayScore",
        "start.pos_team_score",
        "start.def_pos_team_score",
    }
    frames = []
    for s in seasons:
        lf = pl.scan_parquet(f"{pbp_dir}/play_by_play_{s}.parquet")
        have = [c for c in want if c in lf.collect_schema()]
        frames.append(lf.select(have).collect())
    return fitter(pl.concat(frames, how="diagonal_relaxed"))


def main(league: str, pbp_dir: str) -> int:
    trainer.configure(league, pbp_dir, refresh=True)
    train_seasons = trainer.TRAIN_SEASONS
    curve = train_only_curve(league, pbp_dir, train_seasons)
    bundled = paper_index._ep_table(league)
    diff = curve.join(bundled, on="yardline_own", suffix="_bundled").with_columns(
        d=(pl.col("ep") - pl.col("ep_bundled")).abs()
    )
    print(
        f"curve refit on {train_seasons.start}-{train_seasons.stop - 1}: "
        f"max |ep - bundled| {diff['d'].max():.4f}, mean {diff['d'].mean():.4f}"
    )
    # both runs through the same code path, each in its own scratch cache:
    # a probe must leave nothing behind for a later fit to pick up
    with tempfile.TemporaryDirectory() as tmp:
        trainer.CACHE_DIR = pathlib.Path(tmp) / "bundled"
        base = trainer.fit_and_evaluate()["prov"]
        trainer.CACHE_DIR = pathlib.Path(tmp) / "train_only"
        trainer._ep_table = lambda league=league: curve
        paper_index._ep_table = functools.cache(lambda league=league: curve)
        alt = trainer.fit_and_evaluate()["prov"]
    for label, prov in (("bundled curve", base), ("train-only curve", alt)):
        pe = prov["epa_only_paired"]
        print(
            f"{label:>17}: holdout Brier {prov['holdout_brier']:.4f} (EPA-only {prov['epa_only_brier']:.4f}), "
            f"paired mean {pe['mean_delta']:+.4f} se {pe['se']:.4f}, pinned {prov['margins_pinned_to_zero']}"
        )
    print(
        f"paste into fit_paper_index.CURVE_SENSITIVITY[{league!r}]: "
        f"holdout_brier {alt['holdout_brier']}, bundled_curve_holdout_brier {base['holdout_brier']}"
    )
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--league", default="nfl", choices=sorted(_CURVE_FITTERS))
    ap.add_argument("--pbp-dir", required=True)
    args = ap.parse_args()
    sys.exit(main(args.league, args.pbp_dir))
