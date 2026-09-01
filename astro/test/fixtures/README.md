# Test fixtures

## `game-401729745.json.gz`
A real `ProcessedGame` — the exact body the Python API serves for
`GET /cfb/401729745/process` (North Dakota State at Abilene Christian, 2024
week 15, Final; 176 plays, 26 drives, advanced box score). ~3 MB raw, gzipped.

**Provenance (2026-09-01):** generated offline on `sdv-data` by running the
Flask app in `python/` through its test client with `sportsdataverse.cfb.cfb_pbp.download`
patched to return the captured ESPN summary at
`cfbfastR-cfb-raw/cfb/json/raw/401729745.json` (plus `play_participants` and
`game_rosters` from the same repo). No network; no hand edits. Odds override was
not passed (the raw repo's betting shape differs), so `pickcenter`/spread come
from the summary itself.

**Used by:** `test/gamePage.render.test.ts`, which feeds it through
`retrieveProcessedGame` (mocked `wrappedFetch`) and renders `GamePage` with the
Astro Container API.

**To regenerate** after a parser change: repeat the above against the same raw
JSON; the game id must stay the same so the test's URL/JSON-LD assertions hold.
