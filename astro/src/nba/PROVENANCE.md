# src/nba: GOP-owned basketball library (forked from blazing-the-nets)

Forked from https://github.com/saiemgilani/blazing-the-nets at `6566c158` (main, 2026-10-09,
`6566c158937a75cc49ccac9e5fd138557597c706`) by the plan `ClaudeCowork/plans/2026-10-09-nba-shots-gop-pr1.md`, Task 3.

**This code is owned by Game on Paper (spec `ClaudeCowork/specs/2026-10-11-basketball-leagues-design.md`, D5,
2026-10-11).** blazing-the-nets is no longer upstream: behaviour changes are made here, reviewed here, and are not
sent to blazing first; blazing is not changed and nothing is re-copied from it. The directory keeps its name; it
serves every basketball league through `src/basketball/config.ts` (the per-league config) and `src/basketball/periods.ts`.

What the fork started from (kept as history; the files have since diverged where GOP's tests say so):

| file here at the fork | blazing path at `6566c158` |
| --- | --- |
| charts/*.ts | lib/charts/*.ts |
| data/aggregate.ts, data/court.ts, data/games.ts, data/leaders.ts, data/ranks.ts, data/scatter.ts, data/teams.ts (minus readTeams) | lib/data/… |
| dashboard.ts, debounce.ts, format.ts, scatterMetrics.ts, selection.ts, table.ts, seasonRange.ts | lib/… |
| links.ts | lib/links.ts, with the `/nba` prefixes (now league-aware: `leaguePath`) |

Written in GOP from the start: `data/shots.ts`, `data/players.ts` (type-only rewrites), `seasons.ts`, `adapters.ts`
(apart from the function below), `data/game.ts`, `scoreboard.ts`. Rewritten in GOP from blazing functions, over the Data
API's `shot_*` rows: `tables.ts` (from `lib/pageData.ts`'s `playerRows`/`rosterRows`/`teamLines` and `lib/data/teams.ts`'s
`teamsFromShots`, over `shot_season_players` rows) and `adapters.ts`'s `seasonPlayerGamesFromRows` (from `lib/pageData.ts`'s
`seasonPlayerGames`, over `shot_player_games` rows). Not carried over: blazing's `data/releases.ts`, `data/rosters.ts`,
`pageData.ts`, `routes.ts`, `ui.ts`. Tests: `test/nba/*.test.ts` began as blazing's
`test/{aggregate,charts,court,explorer,views}.test.ts` on vitest over `test/fixtures/nba/*.json`.

## CHAR_PX

`charts/theme.ts` keeps blazing's `CHAR_PX = 6.2` (the average advance of an 11 px character,
used to wrap and space labels without measuring). Measured 2026-10-10 on the local preview
(`astro build` + `astro preview`, headless Chromium via Playwright, Windows 10) on
`/nba/players/1629008?season=2026`: after `document.fonts.ready`, a canvas `measureText` of
`"0123456789% FG eFG abcdefghijklmnopqrstuvwxyz"` (45 characters) divided by its length.

- `11px Chivo`: **5.931** px per character (4.3% under 6.2).
- The chart `<text>` does not actually render in Chivo: its computed font is the site's
  `system-ui` stack at 11 px (Segoe UI here), **5.556** px per character (10.4% under 6.2).
  blazingthenets.com's chart text measures the same 5.556 on the same machine (its stack also
  resolves to Segoe UI), and the rendered 11 px chart labels average 4.977 px per character on both.

The constant is not a GOP divergence: both sites draw with the same font and the same 6.2. If
6.2 is to change (it over-estimates widths by about 10% for system-ui on Windows, so labels wrap
early rather than overflow), that is a blazing-first change, then a re-copy; `theme.ts` stays
verbatim here.
