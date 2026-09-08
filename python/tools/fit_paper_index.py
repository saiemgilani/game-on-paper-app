"""Fit the Paper Index weights against a decade of real finals.

The shipped model (python/paper_index.py) is an intercept-free logistic over
eight margins in their advanced-box forms: success rate, explosive-play
rate, explosiveness (EPA per successful play), scoring-opportunity
conversion rate, points per opportunity, starting field position in expected
points, havoc, and turnovers.

Candidate survey that chose this spec (holdout 2024-2025, measured
2026-09-07): EPA-only Brier 0.0805 (mean EPA is one number that hides WHY a
team won, and the unconstrained EPA+success+explosive fit went
sign-incoherent from collinearity: success -1.16, explosive -10.86);
success+explosive 0.1423; +opp conversion 0.1138; +field position (yards)
0.0834; +havoc 0.0790; +turnovers 0.0727; field position re-expressed as the
EP of the average drive start (bundled cfb_field_position_ep curve) = THIS
MODEL, 0.0719 -- the best measured spec, every weight positive, every margin
individually explainable in points/rates in the UI. Also tested and
rejected: field position as drives x EP SUM (0.0819 -- drive-count noise),
line-yards/rush as an extra factor (weight went negative under collinearity
with success+explosiveness), plays/drives margins (zero holdout signal,
w=0.0 standalone), standard/passing-down success splits (no gain over
overall success and sign-incoherent alongside it), and the raw EPA/play
margin (best Brier 0.0606 but four factors flip negative -- the kitchen
sink explains scoreboards by unexplaining its own factors). Adding the
advanced-box forms -- explosiveness as EPA per successful play and scoring
opportunities as points per opportunity, alongside the rate forms -- is the
shipped spec: Brier 0.0657, 91.1% winner agreement, all weights positive.

Run (from python/):
    .venv/bin/python tools/fit_paper_index.py

Gates follow the never-lower rule: every floor is derived from the value
observed at fit time and documented beside its measured number; lowering one
to make it pass is a defect, not a fix.
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
import polars as pl

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from paper_index import _EP_TABLE as EP_TABLE  # noqa: E402
from paper_index import LEAGUE_PTS_PER_OPP, share_from_inputs, team_inputs  # noqa: E402

TRAIN_SEASONS = range(2016, 2024)  # 2016-2023
HOLDOUT_SEASONS = (2024, 2025)
CACHE_DIR = pathlib.Path(__file__).resolve().parent / ".paper_index_cache"
FIXTURE_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "tests"
    / "fixtures"
    / "paper_index_oracle.json"
)
PBP_URL = (
    "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/"
    "espn_cfb_pbp/play_by_play_{season}.parquet"
)
BASE_COLUMNS = [
    "game_id",
    "game_play_number",
    "scrimmage_play",
    "pos_team_id",
    "homeTeamId",
    "awayTeamId",
    "homeScore",
    "awayScore",
    "EPA",
    "EPA_success",
    "EPA_explosive",
]
EXT_COLUMNS = [
    "game_id",
    "pos_team_id",
    "scrimmage_play",
    "is_pos_team_turnover",
    "havoc",
    "scoring_opp",
    "drive.id",
    "drive.isScore",
    "start.yardsToEndzone",
    "EPA",
    "EPA_success",
    "pos_score_pts",
]
# junk guard: a real FBS game has far more than 20 scrimmage snaps a side
MIN_PLAYS_PER_TEAM = 20
FEATS = [
    "success_margin",
    "explosive_margin",
    "expl_epa_margin",
    "oppconv_margin",
    "ppo_margin",
    "fp_margin",
    "havoc_margin",
    "to_margin",
]


def _cast_ids(pbp: pl.DataFrame) -> pl.DataFrame:
    # id dtype discipline: one dtype per id at the boundary (pos_team_id ships
    # i64, and the int-vs-str join-key bug class is the ecosystem's oldest)
    cols = [c for c in ("pos_team_id", "homeTeamId", "awayTeamId") if c in pbp.columns]
    return pbp.with_columns([pl.col(c).cast(pl.Utf8) for c in cols])


def season_game_rows(season: int) -> pl.DataFrame:
    """Per-game base margins (success/explosive/EPA) + winner, disk-cached."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"games_{season}.parquet"
    if cache.exists():
        return pl.read_parquet(cache)
    pbp = _cast_ids(
        pl.read_parquet(PBP_URL.format(season=season), columns=BASE_COLUMNS)
    )
    scrim = pbp.filter(pl.col("scrimmage_play") == True)  # noqa: E712
    per_team = scrim.group_by(["game_id", "pos_team_id"]).agg(
        plays=pl.len(),
        epa=pl.col("EPA").mean(),
        success=pl.col("EPA_success").cast(pl.Float64).mean(),
        explosive=pl.col("EPA_explosive").cast(pl.Float64).mean(),
    )
    finals = (
        pbp.sort("game_play_number")
        .group_by("game_id")
        .agg(
            home_id=pl.col("homeTeamId").last(),
            away_id=pl.col("awayTeamId").last(),
            home_score=pl.col("homeScore").last(),
            away_score=pl.col("awayScore").last(),
        )
    )
    assert finals.schema["home_id"] == per_team.schema["pos_team_id"]
    home = per_team.rename(
        {c: f"h_{c}" for c in ("plays", "epa", "success", "explosive")}
    )
    away = per_team.rename(
        {c: f"a_{c}" for c in ("plays", "epa", "success", "explosive")}
    )
    games = (
        finals.join(
            home,
            left_on=["game_id", "home_id"],
            right_on=["game_id", "pos_team_id"],
            how="inner",
        )
        .join(
            away,
            left_on=["game_id", "away_id"],
            right_on=["game_id", "pos_team_id"],
            how="inner",
        )
        .filter(
            (pl.col("h_plays") >= MIN_PLAYS_PER_TEAM)
            & (pl.col("a_plays") >= MIN_PLAYS_PER_TEAM)
            & (pl.col("home_score") != pl.col("away_score"))
            & pl.col("h_epa").is_finite()
            & pl.col("a_epa").is_finite()
        )
        .with_columns(
            season=pl.lit(season),
            epa_margin=pl.col("h_epa") - pl.col("a_epa"),
            success_margin=pl.col("h_success") - pl.col("a_success"),
            explosive_margin=pl.col("h_explosive") - pl.col("a_explosive"),
            home_won=(pl.col("home_score") > pl.col("away_score")).cast(pl.Int8),
        )
    )
    games.write_parquet(cache)
    return games


def season_ext_rows(season: int) -> pl.DataFrame:
    """Per-game-team opp conversion, field position, havoc-allowed; cached."""
    ext_dir = CACHE_DIR / "ext"
    ext_dir.mkdir(parents=True, exist_ok=True)
    cache = ext_dir / f"ext_{season}.parquet"
    if cache.exists():
        return pl.read_parquet(cache)
    pbp = _cast_ids(pl.read_parquet(PBP_URL.format(season=season), columns=EXT_COLUMNS))
    scrim = pbp.filter(pl.col("scrimmage_play") == True)  # noqa: E712
    base = scrim.group_by(["game_id", "pos_team_id"]).agg(
        havoc_allowed=pl.col("havoc").cast(pl.Float64).mean(),
        turnovers=pl.col("is_pos_team_turnover").cast(pl.Float64).sum(),
        explosiveness=pl.col("EPA").filter(pl.col("EPA_success") == True).mean(),  # noqa: E712
        opp_points=pl.col("pos_score_pts")
        .filter(pl.col("scoring_opp") == True)  # noqa: E712
        .fill_null(0)
        .sum(),
    )
    drv = (
        scrim.filter(pl.col("drive.id").is_not_null())
        .group_by(["game_id", "pos_team_id", "drive.id"])
        .agg(
            opp=pl.col("scoring_opp").any(),
            scored=pl.col("drive.isScore").any(),
            start_yte=pl.col("start.yardsToEndzone").first(),
        )
    )
    drv = drv.with_columns(
        yardline_own=(100 - pl.col("start_yte")).cast(pl.Int64).clip(1, 99)
    ).join(EP_TABLE, on="yardline_own", how="left")
    drives = drv.group_by(["game_id", "pos_team_id"]).agg(
        opp_trips=pl.col("opp").cast(pl.Float64).sum(),
        opp_converted=(pl.col("opp") & pl.col("scored")).cast(pl.Float64).sum(),
        avg_start_yte=pl.col("start_yte").mean(),
        avg_start_ep=pl.col("ep").mean(),
    )
    out = base.join(drives, on=["game_id", "pos_team_id"], how="inner").with_columns(
        opp_conv_rate=pl.when(pl.col("opp_trips") > 0)
        .then(pl.col("opp_converted") / pl.col("opp_trips"))
        .otherwise(0.5),
        pts_per_opp=pl.when(pl.col("opp_trips") > 0)
        .then(pl.col("opp_points") / pl.col("opp_trips"))
        .otherwise(LEAGUE_PTS_PER_OPP),
    )
    out.write_parquet(cache)
    return out


def build_games() -> pl.DataFrame:
    seasons = [*TRAIN_SEASONS, *HOLDOUT_SEASONS]
    games = pl.concat([season_game_rows(s) for s in seasons], how="vertical_relaxed")
    ext = pl.concat([season_ext_rows(s) for s in seasons], how="vertical_relaxed")

    def ren(pfx):
        return {
            c: f"{pfx}{c}" for c in ext.columns if c not in ("game_id", "pos_team_id")
        }

    return (
        games.join(
            ext.rename(ren("h_")),
            left_on=["game_id", "home_id"],
            right_on=["game_id", "pos_team_id"],
            how="inner",
        )
        .join(
            ext.rename(ren("a_")),
            left_on=["game_id", "away_id"],
            right_on=["game_id", "pos_team_id"],
            how="inner",
        )
        .with_columns(
            oppconv_margin=pl.col("h_opp_conv_rate") - pl.col("a_opp_conv_rate"),
            ppo_margin=pl.col("h_pts_per_opp") - pl.col("a_pts_per_opp"),
            expl_epa_margin=pl.col("h_explosiveness") - pl.col("a_explosiveness"),
            fp_margin=pl.col("h_avg_start_ep") - pl.col("a_avg_start_ep"),
            havoc_margin=pl.col("a_havoc_allowed") - pl.col("h_havoc_allowed"),
            to_margin=pl.col("a_turnovers") - pl.col("h_turnovers"),
        )
    )


def fit_logistic_no_intercept(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Newton-Raphson IRLS for an unpenalized, intercept-free logistic fit."""
    beta = np.zeros(X.shape[1])
    for _ in range(50):
        p = 1.0 / (1.0 + np.exp(-(X @ beta)))
        W = p * (1.0 - p)
        step = np.linalg.solve((X * W[:, None]).T @ X, X.T @ (y - p))
        beta = beta + step
        if np.max(np.abs(step)) < 1e-10:
            break
    return beta


def share(X: np.ndarray, beta: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-(X @ beta)))


def brier_decomposition(p: np.ndarray, y: np.ndarray, bins: int = 10):
    """Murphy decomposition: Brier = reliability - resolution + uncertainty."""
    base = y.mean()
    idx = np.clip((p * bins).astype(int), 0, bins - 1)
    reliability = resolution = 0.0
    for b in range(bins):
        mask = idx == b
        if not mask.any():
            continue
        w = mask.mean()
        reliability += w * (p[mask].mean() - y[mask].mean()) ** 2
        resolution += w * (y[mask].mean() - base) ** 2
    return reliability, resolution, base * (1 - base)


def parity_check(games: pl.DataFrame, season: int, n: int = 5) -> None:
    """Train/serve parity: paper_index.team_inputs on the raw pbp must agree
    with this trainer's vectorized aggregation for sampled games."""
    cols = sorted(set(BASE_COLUMNS + EXT_COLUMNS))
    pbp = _cast_ids(pl.read_parquet(PBP_URL.format(season=season), columns=cols))
    pbp = pbp.rename({"pos_team_id": "pos_team"})
    sample = games.filter(pl.col("season") == season).head(n)
    for r in sample.to_dicts():
        gframe = pbp.filter(pl.col("game_id") == r["game_id"])
        for side, tid in (("h", r["home_id"]), ("a", r["away_id"])):
            ti = team_inputs(gframe, tid)
            assert ti is not None, (r["game_id"], tid)
            assert abs(ti["successRate"] - r[f"{side}_success"]) < 1e-9
            assert abs(ti["explosiveRate"] - r[f"{side}_explosive"]) < 1e-9
            assert abs(ti["explosivenessEpa"] - r[f"{side}_explosiveness"]) < 1e-9
            assert abs(ti["ptsPerOpp"] - r[f"{side}_pts_per_opp"]) < 1e-9
            assert abs(ti["oppConversion"] - r[f"{side}_opp_conv_rate"]) < 1e-9
            assert abs(ti["avgStartYardsToEndzone"] - r[f"{side}_avg_start_yte"]) < 1e-9
            assert abs(ti["avgStartEp"] - r[f"{side}_avg_start_ep"]) < 1e-9
            assert abs(ti["havocAllowedRate"] - r[f"{side}_havoc_allowed"]) < 1e-9
            assert abs(ti["turnoversCommitted"] - r[f"{side}_turnovers"]) < 1e-9
    print(
        f"parity check OK: team_inputs == trainer aggregation on {n} games of {season}"
    )


def main() -> int:
    games = build_games()
    train = games.filter(pl.col("season") < HOLDOUT_SEASONS[0])
    hold = games.filter(pl.col("season") >= HOLDOUT_SEASONS[0])
    Xt = train.select(FEATS).to_numpy()
    yt = train["home_won"].to_numpy().astype(float)
    Xh = hold.select(FEATS).to_numpy()
    yh = hold["home_won"].to_numpy().astype(float)
    print(f"train games: {len(yt)}, holdout: {len(yh)} {HOLDOUT_SEASONS}")

    beta = fit_logistic_no_intercept(Xt, yt)
    print("fitted weights:", dict(zip(FEATS, np.round(beta, 4))))
    assert (beta > 0).all(), f"sign-incoherent fit: {beta}"  # every margin must help

    p_hold = share(Xh, beta)
    p_epa_only = share(
        hold.select(["epa_margin"]).to_numpy(),
        fit_logistic_no_intercept(train.select(["epa_margin"]).to_numpy(), yt),
    )
    brier = float(np.mean((p_hold - yh) ** 2))
    brier_epa = float(np.mean((p_epa_only - yh) ** 2))
    pc = np.clip(p_hold, 1e-15, 1 - 1e-15)
    ll = float(-np.mean(yh * np.log(pc) + (1 - yh) * np.log(1 - pc)))
    acc = float(((p_hold > 0.5) == (yh == 1)).mean())
    rel, res, unc = brier_decomposition(p_hold, yh)
    print(
        f"holdout Brier {brier:.4f} (EPA-only ref {brier_epa:.4f}, coin 0.25); "
        f"log-loss {ll:.4f}; acc {acc:.4f}"
    )
    print(
        f"decomposition: reliability {rel:.4f}, resolution {res:.4f}, uncertainty {unc:.4f}"
    )

    # gates (never-lower; measured at fit time: Brier 0.0657, resolution
    # 0.1660, holdout n=1894, beats EPA-only 0.0805)
    assert len(yh) >= 1200, f"holdout too small: {len(yh)}"
    assert brier < 0.09, f"Brier regressed: {brier}"
    assert brier <= brier_epa + 1e-9, f"lost to EPA-only: {brier} vs {brier_epa}"
    assert res > 0.10, f"degraded toward base rate: resolution {res}"
    assert rel < 0.01, f"miscalibrated: reliability {rel}"

    parity_check(games, HOLDOUT_SEASONS[0])

    hold_sorted = hold.with_columns(pl.Series("p_home", p_hold)).sort("p_home")
    picks = hold_sorted[[int(i) for i in np.linspace(0, hold_sorted.height - 1, 12)], :]

    def inputs(r, s):
        return {
            "successRate": r[f"{s}_success"],
            "explosiveRate": r[f"{s}_explosive"],
            "explosivenessEpa": r[f"{s}_explosiveness"],
            "ptsPerOpp": r[f"{s}_pts_per_opp"],
            "oppConversion": r[f"{s}_opp_conv_rate"],
            "avgStartYardsToEndzone": r[f"{s}_avg_start_yte"],
            "avgStartEp": r[f"{s}_avg_start_ep"],
            "havocAllowedRate": r[f"{s}_havoc_allowed"],
            "turnoversCommitted": r[f"{s}_turnovers"],
        }

    fixture = {
        "weights": dict(
            zip(
                [
                    "success",
                    "explosive",
                    "explosive_epa",
                    "opp_conversion",
                    "pts_per_opp",
                    "field_position",
                    "havoc",
                    "turnovers",
                ],
                beta,
            )
        ),
        "provenance": {
            "script": "python/tools/fit_paper_index.py",
            "train_seasons": f"{TRAIN_SEASONS.start}-{TRAIN_SEASONS.stop - 1}",
            "holdout_seasons": list(HOLDOUT_SEASONS),
            "train_games": len(yt),
            "holdout_games": len(yh),
            "holdout_brier": round(brier, 4),
            "holdout_log_loss": round(ll, 4),
            "holdout_accuracy": round(acc, 4),
            "holdout_resolution": round(res, 4),
            "holdout_reliability": round(rel, 4),
            "epa_only_brier": round(brier_epa, 4),
        },
        "games": [
            {
                "gameId": str(r["game_id"]),
                "season": r["season"],
                "homeScore": r["home_score"],
                "awayScore": r["away_score"],
                "home": inputs(r, "h"),
                "away": inputs(r, "a"),
                "expectedHomeShare": r["p_home"],
            }
            for r in picks.to_dicts()
        ],
    }
    # the module must reproduce every fixture share with the JUST-FITTED
    # weights (its committed constants are updated from this printout after)
    import paper_index as _pi

    _pi.WEIGHTS = {k: float(v) for k, v in fixture["weights"].items()}
    for g in fixture["games"]:
        got = share_from_inputs(g["home"], g["away"])["homeShare"]
        assert abs(got - g["expectedHomeShare"]) < 1e-9, (g["gameId"], got)

    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(fixture, indent=1))
    print(f"oracle fixture written: {FIXTURE_PATH}")
    print("\npaste into python/paper_index.py WEIGHTS:")
    for k, v in fixture["weights"].items():
        print(f'    "{k}": {v:.4f},')
    return 0


if __name__ == "__main__":
    sys.exit(main())
