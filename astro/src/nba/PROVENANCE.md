# src/nba: carried over from blazing-the-nets

Copied from https://github.com/saiemgilani/blazing-the-nets at `6566c158` (main, 2026-10-09) by the
plan `ClaudeCowork/plans/2026-10-09-nba-shots-gop-pr1.md`, Task 3. Rules:

- The copied files are blazing's `lib/` with the `.ts` import extensions stripped and nothing
  else changed. A behaviour change goes to blazing first, then is re-copied.
- Rewritten here, type-only: `data/shots.ts`, `data/players.ts` (their parquet readers stay in
  blazing). New here: `seasons.ts` (the pure part of blazing's), `adapters.ts`.
- Adapted: `links.ts` is blazing's `lib/links.ts` with the `/nba` path prefixes (`/players/` ->
  `/nba/players/`, `/teams/` -> `/nba/team/`), GOP indentation and a shorter `seasonQuery`
  comment; `seasonQuery` and `withParams` are unchanged. A re-copy diffs it against upstream.
- Not copied: `data/releases.ts`, `data/rosters.ts`, `pageData.ts`, `routes.ts`, `ui.ts`
  (the Data API, `routes/nba/*.ts` and Bootstrap replace them).
- Tests: `test/nba/*.test.ts` are blazing's `test/{aggregate,charts,court,explorer,views}.test.ts`
  on vitest, over `test/fixtures/nba/*.json` (the same real rows as blazing's parquet fixtures).

| copied file | blazing path |
| --- | --- |
| charts/*.ts | lib/charts/*.ts |
| data/aggregate.ts, data/court.ts, data/games.ts, data/leaders.ts, data/ranks.ts, data/scatter.ts, data/teams.ts (minus readTeams) | lib/data/… |
| dashboard.ts, debounce.ts, format.ts, scatterMetrics.ts, selection.ts, table.ts, seasonRange.ts | lib/… |

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
