# NFL Plans B + C — season data producer and the NFL season surfaces

**Spec:** `docs/superpowers/specs/2026-09-09-nfl-branch-design.md` (phases 3–5).
**Status:** built 2026-09-09 across three repos; this file is the record of what
landed where and what is still gated on a human action. Plan A
(`2026-09-09-nfl-plan-a-game-pages.md`) covered the Python route, the league
abstraction and the ESPN-only `/nfl` pages.

## B — the producer (`sportsdataverse/nfl-data` #36)

`python/nfl_team_summaries/` + stage `python/nfl_data_06_team_summaries.py`,
wired after stage 03 in `nfl_pbp_cron.yml`. From one season of `nfl_model_pbp`:

| tag | grain | contract |
|---|---|---|
| `nfl_team_summaries` | team (ESPN `team_id`, bigint) | the site's `SDVTeamSummary` (383 names) + rbsdm extras |
| `nfl_passing` / `nfl_rushing` / `nfl_receiving` | player, ranks + percentiles among qualifiers | `SDVPassingSummary` / `SDVRushingSummary` / `SDVReceivingSummary` |
| `nfl_percentiles` | 1..99 quantiles of per-game team metrics | `SDVSeasonPercentile` |

The site's TypeScript interfaces are vendored as fixtures in `nfl-data/tests/fixtures/`
and a test asserts zero missing columns per table. rbsdm extras: pass rate /
xpass / PROE (overall + neutral), fourth-down go rate vs the model + boost, luck
(fumble recoveries, opponent FG%), QB CPOE + EPA/CPOE composite. Series success
waits on a `series` column in `model_pbp`.

Decisions that differ from the college producer: no ESPN-sidecar recovery
(nflfastR pbp carries `passer_player_id` on every sack and pick); attempts
exclude sacks; REG only by default; opponent adjustment via sdv-py's
`cfb_adjusted_epa` with an NFL-scale no-op threshold (0.995; 2025 measured .98/.97).

## B — serving it (`sportsdataverse/sdv-db` #57)

Five `release_asset` catalog rows, snapshot entries derived from the built
parquets with ingest's own dtype mapping, `gen_api` regenerated →
`GET /v1/nfl/{team_summaries,passing,rushing,receiving,percentiles}`. Verified
purely additive (5 paths added, 572 existing paths byte-identical).

## C — the site (this branch, in PR #229)

- `LEAGUES[league]` gained `logoLeague`, `teamCount`, `pool`, `extraTeamCategories`;
  `espnLogoLeague()` / `teamCategoriesFor()`. `seasons` became getters to break the
  `constants → misc → league → constants` import cycle.
- Every ESPN team-logo URL (26 sites, incl. the game page) is league-aware — the
  NFL game page had been showing college logos for ids 7 and 13.
- Team + player leaderboards, team index (`/teams`, no longer prerendered), team
  profile, season team page, chart builder, trends, matchup builder, all four
  metric dropdowns: `league` threaded, links prefixed, copy per league
  (`LEADERBOARD_COPY` / `PLAYER_LEADERBOARD_COPY` take `(season, league)`).
- Three NFL-only team categories: `tendencies`, `fourth-downs`, `luck`
  (constants + copy + hover text + formatting); the category list is per league.
- `static/nfl_teams.json` (32 ESPN ids, seasons 2002+).
- Tests: `nflLeaderboards.render.test.ts` renders both leaderboards from real 2025
  producer rows; the NFL game-page test now also asserts NFL logos.

## Gated on a human (in order)

> **Status 2026-09-09:** steps 1–3 and the 2002–2024 backfill in step 5 are DONE (5 tables on
> `/v1/nfl/*` for 2002–2025, `sdvEnabled: true`, NFL week URLs in the sitemap). Step 4 is the
> merge of #229; the `series` column remains open.

1. Merge nfl-data#36; publish 2025 (`python -m nfl_data_06_team_summaries --seasons 2025 --publish`
   or let the Monday cron do it).
2. Merge sdv-db#57; `sdv-db ingest --sport nfl --dataset <tbl> --seasons 2025:2025` × 5;
   re-capture the snapshot (must be a no-op); deploy the API.
3. Flip `LEAGUES.nfl.sdvEnabled` to `true` (one line + the `league.test.ts` expectation) so
   the header offers the NFL leaderboards/teams/charts; add NFL URLs to the sitemap.
4. Merge #229 (deploys to gameonpaper.com).
5. Backfill 1999–2024 per season; `series` column for Series Success.
