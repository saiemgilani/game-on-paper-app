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
shipped spec: Brier 0.0657, 91.1% winner agreement, every weight positive.
The fit is non-negative: a margin whose weight turns negative under
collinearity is pinned to zero and ships as 0.0, never with a sign that
contradicts its name (KKT re-entry lets a pinned margin back in when the
likelihood gradient says a positive weight would help).

Run (from python/):
    .venv/bin/python tools/fit_paper_index.py                  # college (default)
    .venv/bin/python tools/fit_paper_index.py --league nfl     # NFL, from the espn_nfl_pbp release
    .venv/bin/python tools/fit_paper_index.py --league nfl --pbp-dir /path/to/espn_nfl/pbp

Each league is its own fit: its own released play-by-play, its own bundled
field-position EP curve, its own season split (SPLITS), its own oracle
fixture and its own never-lower gates.

Caching: per-season aggregates live under tools/.paper_index_cache/<league>/,
one file per (season, input identity, feature spec). A local parquet is
identified by its size and sha256; a release asset by its size and
updated_at from the GitHub release API (the espn_*_pbp tags are republished
in place, so a path is not an identity). The feature spec is a hash of the
aggregation code itself (the season_*_rows source, the column lists, the
filters), so editing how a row is built invalidates the rows without anyone
remembering to; the ext rows also carry the field-position curve's sha256
and the FG flag, since both are baked in. --refresh rebuilds everything. The first NFL refit
served the previous day's cached rows and reproduced the stale result to
the fourth decimal, which is why the cache is keyed by content.

Gates follow the never-lower rule: every floor is derived from the value
observed at fit time and documented beside its measured number; lowering one
to make it pass is a defect, not a fix. On top of the per-league floors, a
fixed paired rule must hold: with d = (p - y)^2 - (p_epa - y)^2 per holdout
game, mean(d) + 2 * se(d) <= 0, i.e. the eight-margin model beats the
EPA-only baseline by more than two standard errors of the paired difference
(a 1,000-draw bootstrap CI is recorded alongside). A run that fails any gate
prints everything and writes no fixture.

NFL (measured 2026-09-15, espn_nfl_pbp rebuilt with scoring_opp keyed to
start.yardsToEndzone, sportsdataverse-py #495; made field goals counted in
points per opportunity, paper_index.OPP_POINTS_INCLUDE_FG; Pro Bowl games
dropped). Two splits were run, decided once and disclosed:
  * train 2016-2023 / holdout 2024-2025 (n=570): Brier 0.1182 vs EPA-only
    0.1322, explosive-play rate pinned to zero -- but the paired gate FAILED:
    mean(d) -0.0141, se 0.0078, mean+2se +0.0016 (bootstrap 95% CI
    [-0.0299, +0.0010]). The holdout was underpowered.
  * train 2016-2021 / holdout 2022-2025 (n=1,137), the SHIPPED fit: holdout
    widened for power after the 2024-25 holdout failed the paired gate.
    Brier 0.1174 vs EPA-only 0.1374, log-loss 0.3677, 82.8% winner
    agreement, reliability 0.0026, resolution 0.1316; mean(d) -0.0200, se
    0.0054, mean+2se -0.0092 (bootstrap 95% CI [-0.0310, -0.0100]); every
    weight positive, nothing pinned.
Without field-goal points (2024-25 split): Brier 0.1198. The fit on the
pre-#495 data (scoring_opp keyed to the wrong yardline, league points per
opportunity 0.99) lost to EPA-only outright, 0.1373 vs 0.1322, with both
opportunity margins pinned to zero.

Holdout contamination, recorded in provenance["holdout_contamination"]: the
inputs are not fully out-of-sample. The bundled NFL field-position curve is
fitted on 2016-2025 drives and the NFL EP model on 1999-2025, both spanning
the holdout; college's curve is 2018-2021 (clean) but its EP model card
lists training seasons 2004-2025. tools/paper_index_curve_sensitivity.py
refits the curve on the train seasons only and re-runs this fit; its
result is pasted into CURVE_SENSITIVITY below (NFL, 2026-09-15: a curve
fitted on 2016-2021 drives differs by at most 0.28 EP and gives holdout
Brier 0.1177 against 0.1174 with the bundled curve -- the shared curve does
not flatter the evaluation).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata
import inspect
import json
import os
import pathlib
import sys
import urllib.request

import numpy as np
import polars as pl

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from paper_index import (  # noqa: E402
    OPP_POINTS_INCLUDE_FG,
    _ep_table,
    ep_curve_fingerprint,
    opp_points_mask,
    share_from_inputs,
    team_inputs,
)

# (train seasons, holdout seasons) per league. The NFL holdout was widened
# for power after the 2024-25 holdout failed the paired gate (module docstring).
SPLITS: dict[str, tuple[range, tuple[int, ...]]] = {
    "cfb": (range(2016, 2024), (2024, 2025)),
    "nfl": (range(2016, 2022), (2022, 2023, 2024, 2025)),
}
_RELEASE = (
    "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/"
    "espn_{league}_pbp/play_by_play_{{season}}.parquet"
)
_RELEASE_API = (
    "https://api.github.com/repos/sportsdataverse/sportsdataverse-data/releases/tags/"
    "espn_{league}_pbp"
)
_FIXTURE_NAME = {"cfb": "paper_index_oracle.json", "nfl": "paper_index_oracle_nfl.json"}
# never-lower gates, measured at each league's fit time (None = first fit:
# print the numbers, then pin them here before the weights ship). The paired
# EPA-only rule (PAIRED_RULE) applies to every league on top of these.
GATES = {
    # cfb, fit 2026-09-07: Brier 0.0657, resolution 0.1660, holdout n=1894,
    # beats EPA-only 0.0805
    "cfb": {"min_holdout": 1200, "brier": 0.09, "resolution": 0.10, "reliability": 0.01},
    # nfl, fit 2026-09-15 on the 2016-21 / 2022-25 split: Brier 0.1174,
    # resolution 0.1316, reliability 0.0026, holdout n=1137, beats EPA-only
    # 0.1374 (paired mean -0.0200, se 0.0054)
    "nfl": {"min_holdout": 1000, "brier": 0.13, "resolution": 0.10, "reliability": 0.01},
}
PAIRED_RULE = "mean_delta + 2 * se <= 0"
# ESPN NFL team ids 31/32 are the Pro Bowl AFC/NFC squads; a Pro Bowl is not
# a game the model should learn from. College has no such rows.
FRANCHISE_ALLOWLIST = {"nfl": frozenset(range(1, 31)) | {33, 34}}
# a real game has far more than 20 scrimmage snaps a side
MIN_PLAYS_PER_TEAM = 20
# every inner join must keep this share of its left side; a bigger loss is
# an id-dtype or feed problem, not noise
JOIN_KEEP_FLOOR = 0.98
HOLDOUT_CONTAMINATION = {
    "cfb": {
        "field_position_curve": (
            "cfb_field_position_ep.parquet: isotonic fit on 2018-2021 drives (predates the holdout)"
        ),
        "ep_model": (
            "cfb ep_model.ubj: training_seasons 2004-2025 per its model card, holdout "
            "seasons included; the EPA, success and explosiveness inputs carry it"
        ),
    },
    "nfl": {
        "field_position_curve": (
            "nfl_field_position_ep.parquet: fitted on espn_nfl_pbp 2016-2025 drives "
            "(sportsdataverse-py #495), holdout seasons included"
        ),
        "ep_model": (
            "NFL EP model trained on 1999-2025 (sdv-model-reviewer audit of #256), "
            "holdout seasons included; the EPA, success and explosiveness inputs carry it"
        ),
    },
}
# tools/paper_index_curve_sensitivity.py: the curve refitted on the train
# seasons only, this fit re-run against it (bundled-curve number beside it)
CURVE_SENSITIVITY = {
    "cfb": None,
    "nfl": {
        "script": "python/tools/paper_index_curve_sensitivity.py",
        "curve_fit_seasons": "2016-2021",
        "curve_max_abs_ep_shift": 0.2831,
        "holdout_brier": 0.1177,
        "bundled_curve_holdout_brier": 0.1174,
        "measured": "2026-09-15",
    },
}

# set by configure(); module globals so the cached per-season helpers stay simple
LEAGUE = "cfb"
REFRESH = False
TRAIN_SEASONS, HOLDOUT_SEASONS = SPLITS["cfb"]
CACHE_DIR = pathlib.Path(__file__).resolve().parent / ".paper_index_cache" / "cfb"
FIXTURE_PATH = (
    pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "paper_index_oracle.json"
)
PBP_URL = _RELEASE.format(league="cfb")
_INPUTS: dict[int, dict] = {}
_ASSETS: dict[str, dict[str, dict]] = {}


def configure(league: str, pbp_dir: str | None = None, refresh: bool = False) -> None:
    """Point the trainer at one league: its pbp source, split, cache, fixture."""
    global LEAGUE, REFRESH, TRAIN_SEASONS, HOLDOUT_SEASONS, CACHE_DIR, FIXTURE_PATH, PBP_URL
    if league not in _FIXTURE_NAME:
        raise SystemExit(f"unknown league {league!r}; one of {sorted(_FIXTURE_NAME)}")
    LEAGUE = league
    REFRESH = refresh
    TRAIN_SEASONS, HOLDOUT_SEASONS = SPLITS[league]
    FIXTURE_PATH = (
        pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / _FIXTURE_NAME[league]
    )
    PBP_URL = (
        str(pathlib.Path(pbp_dir).resolve() / "play_by_play_{season}.parquet")
        if pbp_dir
        else _RELEASE.format(league=league)
    )
    CACHE_DIR = pathlib.Path(__file__).resolve().parent / ".paper_index_cache" / league
    _INPUTS.clear()


# ---------------------------------------------------------------- inputs


def _release_assets(league: str) -> dict[str, dict]:
    """name -> {size, updated_at} for the league's pbp release (one API call
    per league per process, memoized)."""
    if league in _ASSETS:
        return _ASSETS[league]
    req = urllib.request.Request(
        _RELEASE_API.format(league=league), headers={"Accept": "application/vnd.github+json"}
    )
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=60) as resp:
        release = json.load(resp)
    _ASSETS[league] = {
        a["name"]: {"size": a["size"], "updated_at": a["updated_at"]} for a in release["assets"]
    }
    return _ASSETS[league]


def season_input(season: int) -> dict:
    """The identity of one season's pbp input: a local parquet by size and
    sha256, a release asset by size and updated_at (the tag is republished in
    place, so the URL alone identifies nothing)."""
    if season in _INPUTS:
        return _INPUTS[season]
    src = PBP_URL.format(season=season)
    path = pathlib.Path(src)
    if not src.startswith("http") and not path.exists():
        raise SystemExit(f"{src}: no such file under --pbp-dir")
    if path.exists():
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        ident = {"source": src, "bytes": path.stat().st_size, "sha256": h.hexdigest()}
    else:
        asset = _release_assets(LEAGUE).get(f"play_by_play_{season}.parquet")
        if asset is None:
            raise SystemExit(f"{src}: no such asset on the espn_{LEAGUE}_pbp release")
        ident = {"source": src, "bytes": asset["size"], "updated_at": asset["updated_at"]}
    _INPUTS[season] = ident
    return ident


def _feature_spec(kind: str) -> str:
    """A hash of the code that builds one kind of cached row: the aggregation
    function's source plus the constants it reads. Any edit to how a row is
    built changes the key, so stale rows cannot serve a refit by default."""
    shared = [inspect.getsource(_cast_ids), inspect.getsource(_assert_join_kept), str(JOIN_KEEP_FLOOR)]
    if kind == "games":
        parts = shared + [
            inspect.getsource(season_game_rows),
            json.dumps(BASE_COLUMNS),
            str(MIN_PLAYS_PER_TEAM),
            json.dumps(sorted(FRANCHISE_ALLOWLIST.get(LEAGUE, ()))),
        ]
    else:
        parts = shared + [
            inspect.getsource(season_ext_rows),
            json.dumps(EXT_COLUMNS),
            inspect.getsource(opp_points_mask),
            _ext_key_extra(),
        ]
    return hashlib.sha1("\n".join(parts).encode()).hexdigest()


def _cache_path(kind: str, season: int) -> pathlib.Path:
    # the identity fields only: the same parquet in another directory is the
    # same input (its path stays in the provenance, not in the key)
    ident = {k: v for k, v in season_input(season).items() if k != "source"}
    key = hashlib.sha1(
        (json.dumps(ident, sort_keys=True) + _feature_spec(kind)).encode()
    ).hexdigest()[:12]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{kind}_{season}_{key}.parquet"


def _cached(path: pathlib.Path) -> pl.DataFrame | None:
    if REFRESH or not path.exists():
        return None
    return pl.read_parquet(path)


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
# the same margins under the names paper_index.WEIGHTS ships them by
WEIGHT_NAMES = [
    "success",
    "explosive",
    "explosive_epa",
    "opp_conversion",
    "pts_per_opp",
    "field_position",
    "havoc",
    "turnovers",
]


def _cast_ids(pbp: pl.DataFrame) -> pl.DataFrame:
    # id dtype discipline: one dtype per id at the boundary (pos_team_id ships
    # i64, and the int-vs-str join-key bug class is the ecosystem's oldest)
    cols = [c for c in ("pos_team_id", "homeTeamId", "awayTeamId") if c in pbp.columns]
    return pbp.with_columns([pl.col(c).cast(pl.Utf8) for c in cols])


def _assert_join_kept(joined: pl.DataFrame, left: pl.DataFrame, what: str) -> None:
    assert joined.height >= JOIN_KEEP_FLOOR * left.height, (
        f"{what}: inner join kept {joined.height} of {left.height} rows"
    )


def season_game_rows(season: int) -> tuple[pl.DataFrame, dict]:
    """Per-game base margins (success/explosive/EPA) + winner, disk-cached,
    with the season's row accounting (a JSON sidecar next to the parquet)."""
    cache = _cache_path("games", season)
    sidecar = cache.with_suffix(".json")
    if (games := _cached(cache)) is not None and sidecar.exists():
        return games, json.loads(sidecar.read_text())
    pbp = _cast_ids(pl.read_parquet(PBP_URL.format(season=season), columns=BASE_COLUMNS))
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
    assert finals.schema["game_id"] == per_team.schema["game_id"]
    assert finals.schema["home_id"] == per_team.schema["pos_team_id"]
    counts = {"games_in_pbp": finals.height, "non_franchise_dropped": []}
    if (allow := FRANCHISE_ALLOWLIST.get(LEAGUE)) is not None:
        ids = [str(i) for i in allow]
        keep = pl.col("home_id").is_in(ids) & pl.col("away_id").is_in(ids)
        counts["non_franchise_dropped"] = sorted(
            finals.filter(~keep)["game_id"].cast(pl.Int64).to_list()
        )
        finals = finals.filter(keep)
    home = per_team.rename({c: f"h_{c}" for c in ("plays", "epa", "success", "explosive")})
    away = per_team.rename({c: f"a_{c}" for c in ("plays", "epa", "success", "explosive")})
    joined = finals.join(
        home, left_on=["game_id", "home_id"], right_on=["game_id", "pos_team_id"], how="inner"
    )
    _assert_join_kept(joined, finals, f"{season} home offense")
    joined2 = joined.join(
        away, left_on=["game_id", "away_id"], right_on=["game_id", "pos_team_id"], how="inner"
    )
    _assert_join_kept(joined2, joined, f"{season} away offense")
    counts["after_join"] = joined2.height
    games = joined2.filter(
        (pl.col("h_plays") >= MIN_PLAYS_PER_TEAM)
        & (pl.col("a_plays") >= MIN_PLAYS_PER_TEAM)
        & (pl.col("home_score") != pl.col("away_score"))
        & pl.col("h_epa").is_finite()
        & pl.col("a_epa").is_finite()
    ).with_columns(
        season=pl.lit(season),
        epa_margin=pl.col("h_epa") - pl.col("a_epa"),
        success_margin=pl.col("h_success") - pl.col("a_success"),
        explosive_margin=pl.col("h_explosive") - pl.col("a_explosive"),
        home_won=(pl.col("home_score") > pl.col("away_score")).cast(pl.Int8),
    )
    counts["after_filters"] = games.height
    games.write_parquet(cache)
    sidecar.write_text(json.dumps(counts))
    return games, counts


def _ext_key_extra() -> str:
    # the ext rows bake in the field-position curve and the FG flag
    return json.dumps(
        {"fp_curve": ep_curve_fingerprint(LEAGUE)["sha256"], "fg": OPP_POINTS_INCLUDE_FG[LEAGUE]},
        sort_keys=True,
    )


def season_ext_rows(season: int) -> pl.DataFrame:
    """Per-game-team opp conversion, field position, havoc-allowed; cached."""
    cache = _cache_path("ext", season)
    if (out := _cached(cache)) is not None:
        return out
    cols = EXT_COLUMNS + (["fg_made"] if OPP_POINTS_INCLUDE_FG[LEAGUE] else [])
    pbp = _cast_ids(pl.read_parquet(PBP_URL.format(season=season), columns=cols))
    scrim = pbp.filter(pl.col("scrimmage_play") == True)  # noqa: E712
    base = scrim.group_by(["game_id", "pos_team_id"]).agg(
        havoc_allowed=pl.col("havoc").cast(pl.Float64).mean(),
        turnovers=pl.col("is_pos_team_turnover").cast(pl.Float64).sum(),
        explosiveness=pl.col("EPA").filter(pl.col("EPA_success") == True).mean(),  # noqa: E712
    )
    # opportunity points from the WHOLE pbp through the shared mask, not the
    # scrimmage slice: a made field goal is a non-scrimmage row (see
    # paper_index.opp_points_mask); a team with no such row scored 0
    opp_points = (
        pbp.filter(opp_points_mask(LEAGUE))
        .group_by(["game_id", "pos_team_id"])
        .agg(opp_points=pl.col("pos_score_pts").fill_null(0).sum())
    )
    base = base.join(opp_points, on=["game_id", "pos_team_id"], how="left").with_columns(
        pl.col("opp_points").fill_null(0)
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
    ).join(_ep_table(LEAGUE), on="yardline_own", how="left")
    drives = drv.group_by(["game_id", "pos_team_id"]).agg(
        opp_trips=pl.col("opp").cast(pl.Float64).sum(),
        opp_converted=(pl.col("opp") & pl.col("scored")).cast(pl.Float64).sum(),
        avg_start_yte=pl.col("start_yte").mean(),
        avg_start_ep=pl.col("ep").mean(),
    )
    # pts_per_opp is derived in build_games(): its no-opportunity fill is a
    # fitted constant, and a cache must not bake in whichever value the
    # module happened to hold when the rows were aggregated
    out = base.join(drives, on=["game_id", "pos_team_id"], how="inner").with_columns(
        opp_conv_rate=pl.when(pl.col("opp_trips") > 0)
        .then(pl.col("opp_converted") / pl.col("opp_trips"))
        .otherwise(0.5),
    )
    # a team-game with no drive ids at all would vanish here, unseen by the
    # game-level joins downstream
    _assert_join_kept(out, base, f"{season} drive rows")
    out.write_parquet(cache)
    return out


def build_games() -> tuple[pl.DataFrame, float, dict]:
    """-> (per-game margins for every season, league points per opportunity,
    per-season accounting for the provenance block).

    The league average points per scoring opportunity comes from the TRAIN
    seasons only (the holdout stays unseen) and is the neutral ptsPerOpp for a
    team with no opportunity trips. It is rounded to the 4 decimals
    paper_index.LEAGUE_PTS_PER_OPP ships, so the feature is fitted on exactly
    the value that will serve."""
    seasons = [*TRAIN_SEASONS, *HOLDOUT_SEASONS]
    per_season = {}
    frames = []
    for s in seasons:
        g, counts = season_game_rows(s)
        frames.append(g)
        per_season[str(s)] = {"input": season_input(s), **counts}
    games = pl.concat(frames, how="vertical_relaxed")
    ext = pl.concat(
        [season_ext_rows(s).with_columns(season=pl.lit(s)) for s in seasons],
        how="vertical_relaxed",
    )
    # the constant comes from the rows the fit sees: train seasons, and only
    # games that survived the game-level filters (franchise allowlist, ties,
    # snap floor) -- a Pro Bowl offense must not shape the neutral either
    train_ext = ext.filter(pl.col("season") < HOLDOUT_SEASONS[0]).join(
        games.select("game_id").unique(), on="game_id", how="semi"
    )
    league_ppo = round(
        float(train_ext.select(pl.col("opp_points").sum() / pl.col("opp_trips").sum()).item()),
        4,
    )
    ext = ext.with_columns(
        pts_per_opp=pl.when(pl.col("opp_trips") > 0)
        .then(pl.col("opp_points") / pl.col("opp_trips"))
        .otherwise(league_ppo)
    ).drop("season")

    def ren(pfx):
        return {c: f"{pfx}{c}" for c in ext.columns if c not in ("game_id", "pos_team_id")}

    assert games.schema["game_id"] == ext.schema["game_id"]
    assert games.schema["home_id"] == ext.schema["pos_team_id"]
    joined = games.join(
        ext.rename(ren("h_")),
        left_on=["game_id", "home_id"],
        right_on=["game_id", "pos_team_id"],
        how="inner",
    )
    _assert_join_kept(joined, games, "home ext rows")
    joined2 = joined.join(
        ext.rename(ren("a_")),
        left_on=["game_id", "away_id"],
        right_on=["game_id", "pos_team_id"],
        how="inner",
    )
    _assert_join_kept(joined2, joined, "away ext rows")
    games = joined2.with_columns(
        oppconv_margin=pl.col("h_opp_conv_rate") - pl.col("a_opp_conv_rate"),
        ppo_margin=pl.col("h_pts_per_opp") - pl.col("a_pts_per_opp"),
        expl_epa_margin=pl.col("h_explosiveness") - pl.col("a_explosiveness"),
        fp_margin=pl.col("h_avg_start_ep") - pl.col("a_avg_start_ep"),
        havoc_margin=pl.col("a_havoc_allowed") - pl.col("h_havoc_allowed"),
        to_margin=pl.col("a_turnovers") - pl.col("h_turnovers"),
    )
    for s, n in games.group_by("season").len().iter_rows():
        per_season[str(s)]["games"] = n
    # a fixed row order: the joins above come out of a hash join, and the
    # seeded bootstrap below must not depend on which thread finished first
    games = games.sort(["season", "game_id"])
    return games, league_ppo, per_season


# ------------------------------------------------------------------- fit


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


def fit_logistic_nonneg(X: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, list[int]]:
    """Active-set non-negative logistic fit with KKT re-entry.

    A margin whose weight turns negative under collinearity is pinned to zero
    and the rest refit (one at a time: a second margin may turn positive once
    its collinear partner is gone). A pinned margin re-enters when the
    log-likelihood gradient at the current solution is positive along it --
    the KKT condition for a bound at zero -- so the order of removal cannot
    leave a useful factor pinned. The objective is concave, so the loop ends
    at the constrained optimum: every active weight positive, every pinned
    margin with a non-positive gradient. Returns (beta, pinned column idx).
    Identical to the unconstrained fit when that fit is already positive."""
    active = list(range(X.shape[1]))
    dropped: list[int] = []
    for _ in range(8 * X.shape[1]):
        # an empty active set is the zero logit (every share 0.5); the
        # gradient step below decides whether anything re-enters
        b = fit_logistic_no_intercept(X[:, active], y) if active else np.zeros(0)
        if (b < 0).any():
            worst = active[int(np.argmin(b))]
            dropped.append(worst)
            active.remove(worst)
            continue
        if not dropped:
            break
        grad = X[:, dropped].T @ (y - share(X[:, active], b))
        if grad.max() <= 1e-8:
            break
        back = dropped[int(np.argmax(grad))]
        dropped.remove(back)
        active = sorted(active + [back])
    else:
        raise RuntimeError("non-negative fit did not converge")
    beta = np.zeros(X.shape[1])
    beta[active] = b
    return beta, sorted(dropped)


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


def calibration_table(p: np.ndarray, y: np.ndarray, bins: int = 10) -> list[dict]:
    """Per-bin (n, mean predicted, mean observed) on equal-width bins."""
    idx = np.clip((p * bins).astype(int), 0, bins - 1)
    rows = []
    for b in range(bins):
        mask = idx == b
        rows.append(
            {
                "bin": f"{b / bins:.1f}-{(b + 1) / bins:.1f}",
                "n": int(mask.sum()),
                "mean_p": round(float(p[mask].mean()), 4) if mask.any() else None,
                "mean_y": round(float(y[mask].mean()), 4) if mask.any() else None,
            }
        )
    return rows


def paired_epa_delta(p: np.ndarray, p_epa: np.ndarray, y: np.ndarray, draws: int = 1000) -> dict:
    """The paired per-game Brier difference against the EPA-only baseline:
    mean, standard error and a bootstrap 95% interval (seeded; the rows
    arrive in a fixed order, see build_games). Full precision -- the
    provenance copy is rounded separately."""
    d = (p - y) ** 2 - (p_epa - y) ** 2
    se = float(d.std(ddof=1) / np.sqrt(len(d)))
    rng = np.random.default_rng(0)
    boot = np.array([rng.choice(d, len(d)).mean() for _ in range(draws)])
    return {
        "n": int(len(d)),
        "mean_delta": float(d.mean()),
        "se": se,
        "ci95": [float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))],
        "bootstrap_draws": draws,
        "seed": 0,
        "rule": PAIRED_RULE,
    }


def _rounded(metrics: dict, places: int = 4) -> dict:
    """The serialized copy of a metrics dict: floats to `places`, recursively."""
    out = {}
    for k, v in metrics.items():
        if isinstance(v, float):
            out[k] = round(v, places)
        elif isinstance(v, list):
            out[k] = [round(x, places) if isinstance(x, float) else x for x in v]
        elif isinstance(v, dict):
            out[k] = _rounded(v, places)
        else:
            out[k] = v
    return out


def sdv_identity() -> dict:
    dist = importlib.metadata.distribution("sportsdataverse")
    out = {"version": dist.version, "git_sha": None}
    raw = dist.read_text("direct_url.json")
    if raw:
        out["git_sha"] = json.loads(raw).get("vcs_info", {}).get("commit_id")
    return out


def gate_failures(prov: dict, gates: dict | None) -> list[str]:
    """Every gate the fit fails, as messages; empty means it may ship. The
    trainer passes full-precision metrics; the tests pass the committed
    (rounded) provenance as a re-check of the record."""
    out = []
    if gates is not None:
        if prov["holdout_games"] < gates["min_holdout"]:
            out.append(f"holdout too small: {prov['holdout_games']} < {gates['min_holdout']}")
        if not prov["holdout_brier"] < gates["brier"]:
            out.append(f"Brier regressed: {prov['holdout_brier']} >= {gates['brier']}")
        if not prov["holdout_resolution"] > gates["resolution"]:
            out.append(f"degraded toward base rate: resolution {prov['holdout_resolution']}")
        if not prov["holdout_reliability"] < gates["reliability"]:
            out.append(f"miscalibrated: reliability {prov['holdout_reliability']}")
    if prov["holdout_brier"] > prov["epa_only_brier"] + 1e-9:
        out.append(f"lost to EPA-only: {prov['holdout_brier']} vs {prov['epa_only_brier']}")
    paired = prov["epa_only_paired"]
    if paired["mean_delta"] + 2 * paired["se"] > 0:
        out.append(
            f"EPA-only not beaten at 2 se: mean delta {paired['mean_delta']:.4f}, se {paired['se']:.4f}, "
            f"mean + 2se = {paired['mean_delta'] + 2 * paired['se']:.4f} > 0"
        )
    if paired["ci95"][1] > 0:
        out.append(f"bootstrap 95% interval reaches zero: upper bound {paired['ci95'][1]:.4f}")
    return out


def parity_check(games: pl.DataFrame, season: int, n: int = 5) -> None:
    """Train/serve parity: paper_index.team_inputs on the raw pbp must agree
    with this trainer's vectorized aggregation for sampled games."""
    cols = sorted(set(BASE_COLUMNS + EXT_COLUMNS))
    if OPP_POINTS_INCLUDE_FG[LEAGUE]:
        cols.append("fg_made")
    pbp = _cast_ids(pl.read_parquet(PBP_URL.format(season=season), columns=cols))
    pbp = pbp.rename({"pos_team_id": "pos_team"})
    sample = games.filter(pl.col("season") == season).head(n)
    for r in sample.to_dicts():
        gframe = pbp.filter(pl.col("game_id") == r["game_id"])
        for side, tid in (("h", r["home_id"]), ("a", r["away_id"])):
            ti = team_inputs(gframe, tid, LEAGUE)
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
    print(f"parity check OK: team_inputs == trainer aggregation on {n} games of {season}")


def fit_and_evaluate() -> dict:
    """Build the panel, fit, and score the holdout. Returns everything main()
    prints and records, so a sensitivity run can reuse the exact code path."""
    import paper_index as _pi

    games, league_ppo, per_season = build_games()
    # the module's fitted constants are the JUST-FITTED ones for the parity
    # check and the fixture verification; the committed values are updated
    # from the printout after
    _pi.LEAGUE_PTS_PER_OPP[LEAGUE] = league_ppo
    train = games.filter(pl.col("season") < HOLDOUT_SEASONS[0])
    hold = games.filter(pl.col("season") >= HOLDOUT_SEASONS[0])
    Xt = train.select(FEATS).to_numpy()
    yt = train["home_won"].to_numpy().astype(float)
    Xh = hold.select(FEATS).to_numpy()
    yh = hold["home_won"].to_numpy().astype(float)
    beta, dropped_idx = fit_logistic_nonneg(Xt, yt)
    dropped = [WEIGHT_NAMES[i] for i in dropped_idx]
    p_hold = share(Xh, beta)
    p_epa = share(
        hold.select(["epa_margin"]).to_numpy(),
        fit_logistic_no_intercept(train.select(["epa_margin"]).to_numpy(), yt),
    )
    pc = np.clip(p_hold, 1e-15, 1 - 1e-15)
    rel, res, unc = brier_decomposition(p_hold, yh)
    # full precision: the gates read these; the provenance copy is rounded
    metrics = {
        "holdout_brier": float(np.mean((p_hold - yh) ** 2)),
        "holdout_log_loss": float(-np.mean(yh * np.log(pc) + (1 - yh) * np.log(1 - pc))),
        "holdout_accuracy": float(((p_hold > 0.5) == (yh == 1)).mean()),
        "holdout_resolution": float(res),
        "holdout_reliability": float(rel),
        "holdout_uncertainty": float(unc),
        "epa_only_brier": float(np.mean((p_epa - yh) ** 2)),
        "epa_only_paired": paired_epa_delta(p_hold, p_epa, yh),
    }
    prov = {
        "script": "python/tools/fit_paper_index.py",
        "league": LEAGUE,
        "fitted_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "sportsdataverse": sdv_identity(),
        "pbp_source": PBP_URL,
        "train_seasons": f"{TRAIN_SEASONS.start}-{TRAIN_SEASONS.stop - 1}",
        "holdout_seasons": list(HOLDOUT_SEASONS),
        "seasons": per_season,
        "train_games": int(len(yt)),
        "holdout_games": int(len(yh)),
        "league_pts_per_opp": league_ppo,
        "margins_pinned_to_zero": dropped,
        **_rounded(metrics),
        "calibration": calibration_table(p_hold, yh),
        "fp_curve": ep_curve_fingerprint(LEAGUE),
        "holdout_contamination": {
            **HOLDOUT_CONTAMINATION[LEAGUE],
            "curve_sensitivity": CURVE_SENSITIVITY[LEAGUE],
        },
        "gates": {"league": GATES[LEAGUE], "paired_rule": PAIRED_RULE},
    }
    return {
        "games": games,
        "train": train,
        "hold": hold,
        "beta": beta,
        "p_hold": p_hold,
        "prov": prov,
        "metrics": {**metrics, "holdout_games": int(len(yh))},
    }


def main() -> int:
    import paper_index as _pi

    r = fit_and_evaluate()
    prov, beta, hold = r["prov"], r["beta"], r["hold"]
    print(f"train games: {prov['train_games']}, holdout: {prov['holdout_games']} {HOLDOUT_SEASONS}")
    for s, c in prov["seasons"].items():
        print(
            f"  {s}: {c['games_in_pbp']} games in pbp, {c['after_join']} joined, "
            f"{c['after_filters']} after filters, {c['games']} fitted"
            + (
                f", dropped non-franchise {c['non_franchise_dropped']}"
                if c["non_franchise_dropped"]
                else ""
            )
        )
    print("fitted weights:", dict(zip(FEATS, np.round(beta, 4))))
    if prov["margins_pinned_to_zero"]:
        print(
            f"margins pinned to zero (went negative under collinearity): {prov['margins_pinned_to_zero']}"
        )
    assert (beta >= 0).all(), f"sign-incoherent fit: {beta}"  # every margin must help
    assert (beta > 0).sum() >= 5, f"too few live margins: {beta}"
    print(
        f"holdout Brier {prov['holdout_brier']:.4f} (EPA-only ref {prov['epa_only_brier']:.4f}, coin 0.25); "
        f"log-loss {prov['holdout_log_loss']:.4f}; acc {prov['holdout_accuracy']:.4f}"
    )
    print(
        f"decomposition: reliability {prov['holdout_reliability']:.4f}, "
        f"resolution {prov['holdout_resolution']:.4f}, uncertainty {prov['holdout_uncertainty']:.4f}"
    )
    pe = prov["epa_only_paired"]
    print(
        f"paired vs EPA-only: mean delta {pe['mean_delta']:.4f}, se {pe['se']:.4f}, "
        f"mean + 2se {pe['mean_delta'] + 2 * pe['se']:+.4f}, bootstrap 95% {pe['ci95']} ({PAIRED_RULE})"
    )
    print("calibration (bin, n, mean_p, mean_y):")
    for row in prov["calibration"]:
        print(f"  {row['bin']}  n={row['n']:>5}  p={row['mean_p']}  y={row['mean_y']}")
    print(f"league pts per opportunity (train seasons): {prov['league_pts_per_opp']:.4f}")
    print(
        f"field-position curve: sha256 {prov['fp_curve']['sha256'][:12]}..., points {prov['fp_curve']['points']}"
    )

    gates = GATES[LEAGUE]
    if gates is None:
        print(
            f"FIRST FIT for {LEAGUE}: no gates pinned yet -- pin GATES[{LEAGUE!r}] from "
            f"holdout n={prov['holdout_games']}, Brier {prov['holdout_brier']}, resolution "
            f"{prov['holdout_resolution']}, reliability {prov['holdout_reliability']} before shipping"
        )
    failures = gate_failures(r["metrics"], gates)
    if failures:
        for msg in failures:
            print(f"GATE FAILED: {msg}")
        print("no fixture written; the weights above must not ship")
        return 1

    parity_check(r["games"], HOLDOUT_SEASONS[0])

    hold_sorted = hold.with_columns(pl.Series("p_home", r["p_hold"])).sort("p_home")
    picks = hold_sorted[[int(i) for i in np.linspace(0, hold_sorted.height - 1, 12)], :]

    def inputs(row, s):
        return {
            "successRate": row[f"{s}_success"],
            "explosiveRate": row[f"{s}_explosive"],
            "explosivenessEpa": row[f"{s}_explosiveness"],
            "ptsPerOpp": row[f"{s}_pts_per_opp"],
            "oppConversion": row[f"{s}_opp_conv_rate"],
            "avgStartYardsToEndzone": row[f"{s}_avg_start_yte"],
            "avgStartEp": row[f"{s}_avg_start_ep"],
            "havocAllowedRate": row[f"{s}_havoc_allowed"],
            "turnoversCommitted": row[f"{s}_turnovers"],
        }

    fixture = {
        "weights": dict(zip(WEIGHT_NAMES, [float(b) for b in beta])),
        "provenance": prov,
        "games": [
            {
                "gameId": str(row["game_id"]),
                "season": row["season"],
                "homeScore": row["home_score"],
                "awayScore": row["away_score"],
                "home": inputs(row, "h"),
                "away": inputs(row, "a"),
                "expectedHomeShare": row["p_home"],
            }
            for row in picks.to_dicts()
        ],
    }
    # the module must reproduce every fixture share with the JUST-FITTED weights
    _pi.WEIGHTS[LEAGUE] = dict(fixture["weights"])
    for g in fixture["games"]:
        got = share_from_inputs(g["home"], g["away"], LEAGUE)["homeShare"]
        assert abs(got - g["expectedHomeShare"]) < 1e-9, (g["gameId"], got)

    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(fixture, indent=1))
    print(f"oracle fixture written: {FIXTURE_PATH}")
    print(f"\npaste into python/paper_index.py WEIGHTS[{LEAGUE!r}]:")
    for k, v in fixture["weights"].items():
        print(f'    "{k}": {v:.4f},')
    print(f"and LEAGUE_PTS_PER_OPP[{LEAGUE!r}] = {prov['league_pts_per_opp']:.4f}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Fit the Paper Index weights for one league.")
    ap.add_argument("--league", default="cfb", choices=sorted(_FIXTURE_NAME))
    ap.add_argument(
        "--pbp-dir",
        default=None,
        help="local dir of play_by_play_{season}.parquet (default: the league's release)",
    )
    ap.add_argument(
        "--refresh",
        action="store_true",
        help="rebuild the per-season cache even when its keys match",
    )
    args = ap.parse_args()
    configure(args.league, args.pbp_dir, refresh=args.refresh)
    sys.exit(main())
