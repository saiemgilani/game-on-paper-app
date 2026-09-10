# NFL branch of Game on Paper — design

**Date:** 2026-09-09 · **Branch:** `feat/nfl` (worktree `/mnt/sdv_repos/gop-nfl-wt`)
**Goal:** an NFL section of gameonpaper.com that replicates everything the CFB side
does (scoreboard, game pages with advanced box scores / drives / plays / WP, team
pages, season team + player leaderboards, chart builder, percentile trends) and
covers rbsdm.com's feature set (team tiers, offense/defense tables, QB table with
CPOE, fourth downs, pass rate over expected, neutral pass frequency, series success,
luck). Primary data source is nfl.com (Shield API via `nfl-raw` → `nfl-data`), with
ESPN as the live/backup source.

Everything below was measured against the repos and live endpoints on 2026-09-09,
not inferred.

---

## 0. What exists (measured)

| Layer | CFB today | NFL today |
|---|---|---|
| Game page processing | Flask `/cfb/<id>/process` → `sportsdataverse.cfb.CFBPlayProcess` (ESPN live) | `sportsdataverse.nfl.NFLPlayProcess` exists; smoke run on ESPN 401772944 (LV@DEN 2025 wk10): 175 plays, 3.2 s, all 8 `advBoxScore` sections, 431 columns. Only record-shape gaps vs the CFB route: `success`, `id.x`, and `expectedPoints.*`/`winProbability.*` (which `app.py` deletes anyway). No Flask route. |
| Season data API | `data.sportsdataverse.org/v1/cfb/{team_summaries,team_summaries_weekly,passing,rushing,receiving,percentiles}` | `/v1/nfl/{pbp,schedule,player_stats,team_stats,players,teams,rosters,...}` — nflverse-shape tables. **No** team_summaries / percentiles / leader tables. |
| Season pbp producer | `cfbfastR-cfb-data` `team_summaries.py` ("Binion box score") off `espn_cfb_pbp` | `nfl-data` stages 01–05 publish `nfl_model_pbp` (Shield JSON → nflfastR-parity, `enrich_nfl_pbp(lead_diff)`; 257 cols incl. `epa wpa qb_epa cpoe xpass pass_oe go_boost fourth_down_recommendation punt_wp vegas_wp`; **lacks** `success`, `series`, `pass`/`rush` flags, `qb_dropback`), `nfl_team_stats`, `nfl_player_stats`, `nfl_ratings_weekly`. Cron Mondays Sep–Feb. `model_pbp_2025` = 46,631 plays. |
| ID crosswalks | ESPN team ids everywhere | `nfl.schedule.espn` = ESPN game id (verified `2025_10_LV_DEN → 401772944`). Teams are nflverse abbrs; **no ESPN team-id column** anywhere in the NFL tables. |
| Site | Astro 5 SSR on Cloudflare Workers, Python on a DO droplet via docker-compose. URL space is unprefixed (`/game/[id]`, `/year/[year]/…`); a `/cfb/*` legacy redirect layer already exists (`utils/legacyCfb.ts`). ESPN slug `college-football` hard-coded in ~11 places; `SDV_HTTP_URL` hard-coded to `/v1/cfb`. | nothing |
| rbsdm.com | — | React SPA (Vite dev server, source exposed). Tabs: `teamTiers offense defense quarterbacks fourthDowns passOverExpected neutralPassFreq seriesSuccess luck about`; legacy Shiny `box_scores` app: Game stats / Drives / Passing charts / Play by play / Win probability. Backend is a private `/api` (POST per endpoint). |

## 1. Decisions

### 1.1 One app, `/nfl` path prefix, league-parametric resources
Pages live under `astro/src/pages/nfl/**` mirroring the CFB tree one-for-one.
Components are shared; the three data resources (`sdv.ts`, `espn.ts`, `python.ts`)
gain a `league` parameter that defaults to `cfb`, so every existing CFB route is
byte-for-byte unchanged and the ~210 vitest tests stay green with no edits.

Rejected: a second Astro app / worker (duplicates ~200 components, two deploys);
a subdomain (`nfl.gameonpaper.com`) — can be layered on the prefix later with one
middleware rewrite, not the other way round.

### 1.2 Sources: nfl.com for the season, ESPN for the game page (now)
* **Season aggregates (team/player leaderboards, team pages, charts, percentiles)**
  come from `nfl_model_pbp`, i.e. nfl.com Shield JSON → `nfl-data`. This is the
  "nfl.com ideally" half and it is already the more complete, era-aware, weekly-cron'd
  dataset.
* **Game pages** use ESPN via `NFLPlayProcess`, exactly as CFB does — it is the only
  path that serves in-progress games (live WP chart, scoreboard) and it is proven
  today. The Python route is built behind a `source` switch so a Shield-backed
  processor can be added for completed games without touching the site.
* **NGS** (`sportsdataverse.nfl.nfl_ngs` / `nflpro`) is additive: leader tables with
  air yards, time-to-throw, separation, RYOE/YACOE on player leaderboards. Phase 5;
  not on the critical path.

Consequence to document in the glossary: the two paths apply the same sdv-py NFL
model bundle through different feature-construction code (`NFLPlayProcess` vs
`enrich_nfl_pbp(lead_diff)`), so a game-page EPA and the season table's EPA for
the same play can differ at the second decimal. Same caveat CFB already carries.

### 1.3 Team key = ESPN team id, always
The GOP URL space, logos, `TeamCard`, `/team/[id]` and the SDV contract all key on
ESPN team ids. The NFL producer will therefore emit `team_id` (ESPN id, 1–34) and
`pos_team` (nflverse abbr) on every row, from a vendored 32-row crosswalk
(`nfl-data/python/nfl_team_summaries/data/espn_team_ids.csv`, captured from
`site.api.espn.com/.../nfl/teams` and asserted complete by a test). The site's
`static/nfl_teams.json` carries the same crosswalk plus seasons.

### 1.4 Reuse the CFB column contract; extend for rbsdm
`SDVTeamSummary` is a 400-column grid `{metric}_{off|def|margin}[_{pass|rush}][_rank]`
(`EPAplay`, `success`, `explosive`, `havoc`, `third_down_success`, `red_zone_success`,
`available_yards_pct`, `adj_off_epa`/`adj_def_epa`/`net_adj_epa`, …). The NFL
`team_summaries` emits the **same names** so the leaderboard / team-card / radar /
chart-builder code is a pure league swap. CFB-only fields (`fbs_class`,
`conference`, `division`) are populated with NFL conference (`AFC`/`NFC`) and
division so the existing filters still work.

rbsdm adds columns the CFB grid does not have. They are added to the NFL
`team_summaries` and surfaced as new leaderboard categories (no new page types):

| rbsdm tab | new columns (all also get `_rank`) | derivation from `model_pbp` |
|---|---|---|
| Quarterbacks | on `passing`: `cpoe`, `qb_epa_play`, `dropbacks`, `epa_cpoe_composite` | `cpoe` mean over attempts; `qb_epa` over dropbacks; composite = rbsdm's `0.5·z(EPA/db)+0.5·z(CPOE)` scaled |
| Fourth Downs | `fourth_go_rate_off`, `fourth_go_boost_off`, `fourth_go_expected_off`, `fourth_go_over_expected_off` | plays with `down==4` and a recommendation; went-for-it = `pass_attempt|rush_attempt|qb_scramble`; expected = mean `go_boost>0`; boost = mean `go_boost` on go decisions |
| Pass Over Expected / Neutral Pass Freq | `pass_rate_off`, `xpass_rate_off`, `pass_oe_off`; `neutral_pass_rate_off` (`down∈{1,2}`, `wp∈[.2,.8]`, `qtr<4`, `half_seconds_remaining>120`) | `pass_oe`/`xpass` already on the frame |
| Series Success | `series_conv_off/def`, `series_td_rate`, `series_fg_rate`, `series_punt_rate`, `series_to_rate`, `first_down_rate` | requires `series` → **producer gap**: `native_pbp/series.py` exists but the column is not in the release; stage 02 gains it (nflfastR `series`/`series_result` parity) |
| Luck | `luck_fumble_rec_pct_off/def`, `luck_fg_pct_def`, `luck_int_rate_def` | `fumble`, `fumble_lost`, `field_goal_result`, `interception` |
| Team Tiers | none — chart builder over `EPAplay_off` × `EPAplay_def` (and `adj_*`) | existing |

`success` is derived as `epa > 0` on scrimmage plays (nflfastR definition), `pass`
= `pass_attempt|sack|qb_scramble` (dropback), `rush` = `rush_attempt & !qb_scramble`.

### 1.5 Percentiles
`nfl_percentiles` mirrors `espn_cfb_percentiles` (99 rows × metric columns — the
distribution reference `retrievePercentiles()` already consumes), computed over
team-seasons 1999–current so the trends chart works on day one.

## 2. Delivery chain and where each new piece lives

```
nfl-raw (Shield JSON)  ──►  nfl-data 01–05 → nfl_model_pbp (+ series col)         [exists; +1 col]
                            nfl-data 06 nfl_team_summaries → 5 release tags          [NEW producer]
                                └► sportsdataverse-data: nfl_team_summaries, nfl_passing,
                                   nfl_rushing, nfl_receiving, nfl_percentiles
                                     └► sdv-db catalog rows (release_asset) + generated
                                        endpoints → data.sportsdataverse.org/v1/nfl/…   [catalog edit]
                                          └► GOP sdv.ts(league="nfl")                  [param]
ESPN nfl summary ──► GOP python /nfl/<id>/process (NFLPlayProcess)                    [NEW route]
                       └► GOP python.ts(league="nfl") → /nfl/game/[id]                 [pages]
```

## 3. Components

### 3.1 `game-on-paper-app/python`
* `app.py`: extract the record-reshaping block of `process()` into
  `_reshape_processed(processed_game)` (pure, tested) and register
  `/nfl/<int:game_id>/process` using `NFLPlayProcess` with `espn_nfl_pbp()`.
  League is a parameter of one `_process(league, game_id)` helper; the two routes
  are two lines. `success` is filled from `EPA > 0` when absent; `id.x` falls back to
  `id`. DQ + telemetry rows carry `league`.
* `span_box.py`: verify league-agnostic (it windows `game.plays_json`); parametrize
  the processor class if needed.
* Tests: `tests/test_nfl_route.py` monkeypatches `NFLPlayProcess` with a 3-play
  fixture (pattern of `test_espn_proxy.py`) and asserts the reshaped record shape
  equals the CFB one on a shared key list.

### 3.2 `game-on-paper-app/astro`
* `utils/league.ts` — `type League = 'cfb' | 'nfl'`; `LEAGUES[league]` =
  `{ slug, espnPath, espnScoreboardQuery, sdvApiBase, pythonPathPrefix, seasons,
  teamsStatic, leaderboardCategories, playerCategories, glossaryExtras, urlPrefix }`.
  `leagueFromPath(pathname)` and `withLeague(league, path)` build URLs; cfb's
  `urlPrefix` is `''` so nothing moves.
* `resources/sdv.ts` / `espn.ts` / `python.ts`: thread `league` (default `'cfb'`)
  into URL construction and cache keys. Cache keys MUST include the league —
  `/nfl/game/401772944` and `/game/401772944` are different games only by league.
* `pages/nfl/**`: `index.astro` (scoreboard), `game/[id].astro`, `game/matchup.astro`,
  `team/[id].astro`, `teams.astro`, `year/[year]/{teams,players,team}/…`,
  `year/[year]/type/[type]/week/[week].astro`, `charts/{builder,trends}.astro`,
  `glossary.astro`. Each is a thin wrapper that resolves `league='nfl'` and renders
  the shared component. Where a CFB page hard-codes `college-football` (11 sites) the
  string moves to `LEAGUES[league].espnPath`.
* `components/Header.astro`: league switcher (CFB | NFL) that preserves the current
  path shape; nav items use `withLeague`.
* `static/nfl_teams.json` (ESPN id, abbr, name, seasons) and `static/nfl_groups.json`
  (conferences/divisions) mirror the CFB statics.
* `utils/constants.ts`: `NFL_AVAILABLE_SEASONS` (1999+, gated by what the producer
  published), `SDV_TEAM_METRIC_CATEGORIES` gains the rbsdm categories, keyed so
  CFB's category list is unchanged.
* `middleware.ts`: `GAME_ID_RE` already matches `/nfl/game/123`; add `league` to the
  telemetry collector. `legacyCfb.ts` untouched.
* `sitemap.xml.ts`, `seo.ts`: emit NFL URLs; `admin/api/purge-game.ts` accepts
  `league`.
* Tests: `league.test.ts` (path ↔ league, prefixing), `nflGamePage.render.test.ts`
  (mirror of `gamePage.render.test.ts` with the NFL fixture), `nflScoreboard.render.test.ts`,
  `sitemap.test.ts` extended. CFB tests unchanged.

### 3.3 `nfl-data`
* `python/nfl_team_summaries/` (library) + `python/nfl_data_06_team_summaries.py`
  (numbered stage, same thin-shim shape as stage 05) + `scripts/nfl_data.sh` picks it
  up automatically (`ls nfl_data_[0-9][0-9]_*.py`).
  - `input.py`: read `model_pbp_{season}.parquet` (release or local), derive
    `success/pass/rush/dropback`, join `nfl.schedule` for ESPN game id, join the
    team crosswalk, filter to scrimmage plays; kneel-down strip (`qb_kneel`).
  - `summaries.py`: **port** of `cfb_data_build/team_summaries.py` renaming the
    nflfastR columns at the boundary (`epa→EPA`, `posteam→pos_team`, …) so the grid
    math is shared by transcription, not reinvented; opponent adjustment via
    `sportsdataverse.cfb.cfb_adjusted_epa` (league-agnostic ridge over
    `pos_team/def_pos_team/EPA`; verified signature) or `nfl_ratings` if it needs the
    NFL-specific home-field term.
  - `rbsdm.py`: the §1.4 extras.
  - `percentiles.py`: `prepare_percentiles` port.
  - `publish.py`: reuse `nfl_model_publish` upload helpers; tags
    `nfl_team_summaries nfl_passing nfl_rushing nfl_receiving nfl_percentiles`.
  - Tests: `tests/test_team_summaries.py` on a committed 2-game slice of
    `model_pbp_2025` (fixture ≤ 300 KB): column contract vs a vendored list of the
    CFB `SDVTeamSummary` names, `_rank` ↔ `_pct` pairing, every `asc_cols` ∈ `rank_cols`
    (the guard just added to CFB #50), no null percentile denominators, crosswalk
    completeness (32 teams, 32 ESPN ids).
* `native_pbp`: add `series` / `series_result` / `series_success` to the model_pbp
  output (the code exists in `series.py`; wire + test). Backfill note: re-publishing
  model_pbp is a per-season commit/push per the data-repo rule.
* `.github/workflows/nfl_pbp_cron.yml`: append stage 06 after 03; `models/manifest.yaml`
  + `tests/test_model_manifest.py` lockstep.

### 3.4 `sdv-db`
* `catalog.py`: `Dataset(league="nfl", name=…, source="release_asset", tag=…)` × 5.
* Regenerate `api/generated/endpoints.py` (the `gen/curation.yaml` + snapshot flow)
  so `/v1/nfl/team_summaries` etc. exist with `season`, `team_id`, `pos_team`
  filters; run ingest once for 2025 then backfill.

### 3.5 Deploy
No infra change: the Python image already installs sdv-py `main` at build
(`deploy.yml` "Resolve sportsdataverse-py main"), and the worker routes are dynamic.
Cloudflare Workers Caching keys are URL-based so `/nfl/*` is naturally separate.

## 4. Phases (each is a PR; each ends with the gate that CI runs)

| # | Deliverable | Gate |
|---|---|---|
| 1 | Python `/nfl/<id>/process` + reshape extraction + tests | `uv run pytest` in `python/` |
| 2 | `league.ts` + parametrized resources + `/nfl` scoreboard, game page, matchup, week pages (ESPN-only; no season data needed) + header switcher | `npx vitest run`; render tests for `/nfl/game/[id]` |
| 3 | `nfl-data` stage 06 producer + `series` col + publish 2025 + sdv-db catalog/endpoints/ingest | nfl-data `uv run pytest`; live check `GET /v1/nfl/team_summaries?season=2025` returns 32 rows |
| 4 | `/nfl` team pages, teams index, season team + player leaderboards, chart builder, trends | vitest; manual: every nav link on `/nfl` resolves 200 |
| 5 | rbsdm categories (QB, fourth downs, pass OE, neutral pass, series, luck) as leaderboard categories + glossary entries; NGS columns on player boards | vitest + producer tests |
| 6 | Backfill 1999–2024 (per-season commits), sitemap/SEO, purge-game league, changelog | ingest counts per season |

Phases 1–2 ship a usable NFL section from ESPN alone; 3–4 make the season side
real; 5–6 are the rbsdm parity and history.

## 5. Testing strategy
* **Offline first.** Every new Python route/producer test runs on committed fixtures;
  no test hits ESPN or GitHub releases. The one live check (phase 3 gate) is a
  documented manual step.
* **Contract tests, not screenshots.** The NFL producer's column set is asserted
  against the vendored CFB name list; the Flask NFL record is asserted against the
  CFB record's key set. That is what keeps the shared components honest.
* **Zero CFB regressions**: no existing test file changes in phases 1–2. If one has
  to, that is a design smell to stop on.
* Local limits (droplet): node v20 cannot run `astro check`/`astro build` — CI covers
  `.astro` template errors. vitest + pytest are the local definition of done.

## 6. Risks / open items
1. **`series` column** is missing from `model_pbp`; without it Series Success is
   deferred, not faked. Phase 3 wires it.
2. **Two EPA paths** (§1.2). Documented in glossary; not reconciled here.
3. **Season semantics**: nflverse `season` = starting year, matching CFB; POST weeks
   map to ESPN `seasontype=3` weeks 1–5 (WC/DIV/CONF/PB/SB); the week page must not
   assume 15 weeks.
4. **In-season freshness**: `nfl_model_pbp` cron is Mondays; team pages will lag
   Sunday games until the cron runs. The scoreboard and game pages are live via ESPN.
   If that lag matters, the fix is cron cadence in `nfl-data`, not a second producer.
5. **Preseason** games exist on ESPN (`seasontype=1`) but not in `model_pbp`; the
   scoreboard shows them, the season tables ignore them — by design, state it.
6. **ESPN payload drift for NFL** (`drives.previous`, `pickcenter`) — the smoke run
   passed on a 2025 game; a 2026 in-progress game should be smoke-tested before
   phase 2 merges.
7. No new secrets; the Python token/auth pattern is reused as is.
