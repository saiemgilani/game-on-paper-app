# src/nba: carried over from blazing-the-nets

Copied from https://github.com/saiemgilani/blazing-the-nets at `6566c158` (main, 2026-10-09) by the
plan `ClaudeCowork/plans/2026-10-09-nba-shots-gop-pr1.md`, Task 3. Rules:

- The copied files are blazing's `lib/` with the `.ts` import extensions stripped and nothing
  else changed. A behaviour change goes to blazing first, then is re-copied.
- Rewritten here, type-only: `data/shots.ts`, `data/players.ts` (their parquet readers stay in
  blazing). New here: `seasons.ts` (the pure part of blazing's), `adapters.ts`, `links.ts`.
- Not copied: `data/releases.ts`, `data/rosters.ts`, `pageData.ts`, `routes.ts`, `ui.ts`,
  `links.ts` (the Data API, `routes/nba/*.ts` and Bootstrap replace them).
- Tests: `test/nba/*.test.ts` are blazing's `test/{aggregate,charts,court,explorer,views}.test.ts`
  on vitest, over `test/fixtures/nba/*.json` (the same real rows as blazing's parquet fixtures).

| copied file | blazing path |
| --- | --- |
| charts/*.ts | lib/charts/*.ts |
| data/aggregate.ts, data/court.ts, data/games.ts, data/leaders.ts, data/ranks.ts, data/scatter.ts, data/teams.ts (minus readTeams) | lib/data/… |
| dashboard.ts, debounce.ts, format.ts, scatterMetrics.ts, selection.ts, table.ts, seasonRange.ts | lib/… |
