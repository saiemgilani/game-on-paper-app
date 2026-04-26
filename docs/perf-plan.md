# Performance & observability plan

5-day plan to add baseline instrumentation, tests, and CI gates before the
Cloudflare migration. Each day is independently shippable.

## Status

- **Day 1 — Baseline observability**: not started
- **Day 2 — Python snapshot tests**: not started
- **Day 3 — Playwright E2E**: not started
- **Day 4 — JSON Schema contract**: not started
- **Day 5 — Lighthouse CI**: not started
- Last updated: 2026-04-25

## Resume hint for Claude Code

1. Find the next day whose status is not "completed".
2. Find the first unchecked task (`☐`) in that day.
3. Do that task, check it off (`☑`), and continue down the list.
4. When all of a day's tasks are checked, mark the day completed in Status
   above and fill in the **Notes** subsection with decisions, deviations, or
   anything surprising.
5. If the user says "continue the perf plan", start at step 1 with no further
   confirmation needed.

## Baseline metrics

Captured during Day 1, used as the reference point for subsequent measurement.

- LCP (homepage, US, warm): _tbd_
- LCP (game page, US, warm): _tbd_
- LCP (international): _tbd_
- TTFB (homepage): _tbd_
- TTFB (game page, completed): _tbd_
- TTFB (game page, in-progress, cache miss): _tbd_
- `Server-Timing` breakdown (game page cache miss): _tbd_
- Lighthouse perf score (homepage / game / leaderboard): _tbd_
- Page weight transferred (homepage / game): _tbd_

---

## Day 1 — Baseline observability

**Outcome**: Every response carries `Server-Timing`; both services emit
structured JSON logs; Cloudflare Web Analytics live; baseline numbers captured
in the section above.

**Estimate**: 4–6h.

### Tasks

- ☐ Wrap `/cfb/process` in [python/app.py](../python/app.py) with
  `time.perf_counter()` around four stages: `espn_fetch` (the
  `espn_cfb_pbp()` call), `pipeline` (`run_processing_pipeline`),
  `box_score` (`create_box_score`), and `serialize` (the dict reshape +
  `jsonify`).
- ☐ Set `Server-Timing: espn;dur=…, pipeline;dur=…, box_score;dur=…,
  serialize;dur=…` header on the response.
- ☐ Emit one structured JSON log line per request with the same timings,
  `gameId`, status code, and total duration. Use a dedicated logger so it can
  be split out from access logs.
- ☐ In [frontend/cfb/routes.js](../frontend/cfb/routes.js) and
  [frontend/cfb/games.js](../frontend/cfb/games.js), time the upstream axios
  calls (Python service, ESPN, summary service, Redis). Set `Server-Timing`
  on the outbound response before `res.render` / `res.json`.
- ☐ Replace `morgan`'s default text format in
  [frontend/server.js](../frontend/server.js) with a JSON formatter (custom
  format string with all tokens + content-length + response-time).
- ☐ Sign up for Cloudflare Web Analytics (free, no consent banner needed).
  Get the site token.
- ☐ Extract a shared `<head>` partial — there isn't one today; every EJS
  page repeats `<head>` (e.g. [index.ejs:3-53](../frontend/views/pages/cfb/index.ejs)).
  Create `frontend/views/partials/head.ejs` with the existing meta + favicon
  + the Plausible snippet + the new Cloudflare Web Analytics snippet, accept
  a `title` local. Replace the `<head>` block in all 12 page templates with
  `<%- include('../../partials/head', { title: titleText }) %>`.
- ☐ Build and run the stack locally; verify `Server-Timing` shows up in
  DevTools → Network → headers for `/cfb/` and `/cfb/game/401403910`.
- ☐ Deploy to prod. Wait 24h for CF Web Analytics to collect data.
- ☐ Capture baseline numbers in the Baseline metrics section above.
  Screenshots into `docs/baseline/` if helpful.

### Acceptance

- `curl -I http://localhost:8000/cfb/` shows `Server-Timing` header with
  multiple metrics.
- `curl -X POST http://localhost:7000/cfb/process -d '{"gameId":401403910}'
  -H 'Content-Type: application/json' -i` shows `Server-Timing` with all
  four stages.
- CF Web Analytics dashboard shows traffic from prod.
- Baseline metrics section above is filled in.

### Notes

_(fill in as you go)_

---

## Day 2 — Python snapshot tests

**Outcome**: Captured ESPN fixtures + snapshot tests for `/cfb/process`
output; CI runs `pytest` on every push.

**Estimate**: 3–5h.

### Tasks

- ☐ Write `python/tests/capture_fixtures.py`: takes a gameId, hits
  `https://cdn.espn.com/core/college-football/playbyplay?gameId={id}&xhr=1`
  and `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={id}`,
  saves raw JSON to `python/tests/fixtures/<gameId>/{pbp.json, summary.json}`.
  Also save any ESPN endpoint that `sportsdataverse.dl_utils.download` calls
  during processing (run with a logging proxy first to enumerate them).
- ☐ Capture three fixtures:
  - `401403910` (the existing test gameId; completed regular season)
  - One OT game (suggest `401520434` — verify it has OT before committing)
  - One [QUARANTINE_LIST](../frontend/cfb/routes.js) ID, e.g.
    `401628329` — these games exposed real bugs historically and make great
    regression tests.
- ☐ In [python/tests/conftest.py](../python/tests/conftest.py), add a
  `mock_espn` fixture that monkeypatches `sportsdataverse.dl_utils.download`
  to dispatch URL → fixture file by parsing the gameId out of the URL.
- ☐ Run the pipeline once per fixture, save the resulting `/cfb/process`
  response as `python/tests/fixtures/<gameId>/expected.json`. This is the
  snapshot.
- ☐ Add `python/tests/test_process_snapshot.py`: parametrize over the three
  fixtures, assert `client.post('/cfb/process', json={'gameId': id}).get_json()
  == expected`. On mismatch, write the actual output to
  `expected.actual.json` so diffing is one command.
- ☐ Pin `xgboost` more tightly in [python/requirements.txt](../python/requirements.txt)
  (e.g. `xgboost==2.1.*` — model output is sensitive to xgboost minor
  versions). Verify the snapshot still passes after pinning.
- ☐ Add `.github/workflows/test.yml`: trigger on push and pull_request, run
  `pip install -r python/requirements.txt -r python/requirements-dev.txt`
  then `pytest python/tests -m "not integration"`.

### Acceptance

- `pytest -m "not integration"` passes locally and in CI.
- Manually editing a column name in [python/app.py:82-205](../python/app.py)
  produces a clean diff in `expected.actual.json`.
- Total test time under 30s.

### Notes

_(fill in as you go)_

---

## Day 3 — Playwright E2E

**Outcome**: Three browser tests; nightly run against prod; ready to wire
into PR previews after Tier 2 of the Cloudflare migration.

**Estimate**: 4–6h.

### Tasks

- ☐ `cd frontend && npm i -D @playwright/test` and check in
  `package-lock.json` (it isn't currently committed — fix that here).
- ☐ `npx playwright install --with-deps chromium`.
- ☐ `frontend/playwright.config.js`: `baseURL` from `BASE_URL` env, default
  `https://www.gameonpaper.com`. Single project (chromium desktop).
  Workers: 2. Retries: 1 on CI, 0 locally.
- ☐ `frontend/tests/e2e/scoreboard.spec.js`: visit `/cfb/`, assert at least
  one game thumb element is visible (use a stable selector — inspect
  [game_thumb.ejs](../frontend/views/pages/cfb/game_thumb.ejs) to find one),
  assert no uncaught console errors.
- ☐ `frontend/tests/e2e/game.spec.js`: visit `/cfb/game/401403910`, assert
  score text matches `/\d+ - \d+/`, assert `canvas#wpChart` exists, assert
  the drive table has at least one row.
- ☐ `frontend/tests/e2e/leaderboard.spec.js`: visit
  `/cfb/year/2024/teams/differential` (use a completed season for stability),
  assert table has ≥100 rows.
- ☐ `.github/workflows/e2e.yml`: triggers on `pull_request` and
  `schedule: cron: '30 14 * * *'` (daily 14:30 UTC). Upload Playwright HTML
  report as artifact on failure.
- ☐ Add a note in this plan and in [CLAUDE.md](../CLAUDE.md): "PR previews
  come with Tier 2 (Cloudflare Pages migration); until then PR runs hit
  prod or are skipped on PR." Decide which.

### Acceptance

- `BASE_URL=https://www.gameonpaper.com npx playwright test` passes locally.
- Nightly cron run is green in GH Actions.
- Failing test produces a downloadable HTML report.

### Notes

_(fill in as you go)_

---

## Day 4 — JSON Schema contract

**Outcome**: One canonical schema for `/cfb/process` response; both Python
and Node validate against it; drift fails CI.

**Estimate**: 3–4h.

### Tasks

- ☐ Add `pydantic>=2` to [python/requirements.txt](../python/requirements.txt).
- ☐ Create `python/schemas.py` with a `ProcessResponse` pydantic model
  covering the keys produced at [python/app.py:232-257](../python/app.py).
  Cover at minimum: `id`, `count`, `plays[]` (with nested `clock`, `type`,
  `start`, `end`, `winProbability`, `expectedPoints`, `modelInputs`),
  `box_score`, `homeTeamId`, `awayTeamId`, `header`, `drives`,
  `scoringPlays`, `winprobability`, `pickcenter`, `homeTeamSpread`,
  `overUnder`. Use `Optional` liberally — ESPN payloads are inconsistent.
- ☐ In [python/app.py](../python/app.py) `/cfb/process`, validate `result`
  with `ProcessResponse.model_validate(result)` before `jsonify`. Behavior
  controlled by env var `STRICT_SCHEMA`: `1` raises (used in tests), default
  warns and continues (used in prod). Log validation failures structured.
- ☐ Add a `make schema` target (or `python/Makefile`) that runs
  `python -c "from schemas import ProcessResponse; import json; print(json.dumps(ProcessResponse.model_json_schema(), indent=2))" > shared/process-response.schema.json`.
  Commit `shared/process-response.schema.json`.
- ☐ `cd frontend && npm i ajv ajv-formats`. In
  [frontend/cfb/games.js `_remoteRetrievePBP`](../frontend/cfb/games.js),
  load the schema once at module init, validate the response from Python,
  log a structured warning on mismatch (don't block — warn-only for now).
- ☐ Extend the snapshot test from Day 2: assert each fixture's
  `expected.json` validates against `shared/process-response.schema.json`
  using `jsonschema` in Python.
- ☐ Add a CI step that re-generates the schema and fails if the committed
  file is out of date (`git diff --exit-code shared/process-response.schema.json`).

### Acceptance

- Renaming a field in [python/app.py:82-205](../python/app.py) reshape
  fails Python validation in tests AND triggers a Node warning log against
  prod.
- The committed `shared/process-response.schema.json` matches what
  `make schema` produces.

### Notes

_(fill in as you go)_

---

## Day 5 — Lighthouse CI

**Outcome**: PR-blocking perf gate with realistic baseline; tighten over time
as Tier 1 → Tier 2 → Tier 3 of the Cloudflare migration land.

**Estimate**: 2–3h.

### Tasks

- ☐ `cd frontend && npm i -D @lhci/cli`.
- ☐ Capture current Lighthouse scores against prod for three URLs:
  - `https://www.gameonpaper.com/cfb/`
  - `https://www.gameonpaper.com/cfb/game/401403910`
  - `https://www.gameonpaper.com/cfb/year/2024/teams/differential`
  Run `npx lhci autorun --collect.url=… --collect.numberOfRuns=3` three
  times, take the median. Record numbers in the Baseline metrics section
  above.
- ☐ Create `frontend/lighthouserc.json`: 3 URLs, 3 runs each, desktop preset.
  Set assertion thresholds at **current baseline minus 5%** (so any
  regression fails). Use `assertions` for `categories:performance`,
  `largest-contentful-paint`, `total-byte-weight`, `unused-javascript`.
- ☐ Create `.github/workflows/lighthouse.yml`: runs on `pull_request`,
  `npx lhci autorun --upload.target=temporary-public-storage`, posts the
  report URL as a PR comment via the LHCI GitHub app or
  `actions/github-script`.
- ☐ Add a follow-up checklist item in this plan: "After Tier 1 ships,
  re-baseline Lighthouse and tighten thresholds. Repeat after Tier 2."

### Acceptance

- Opening a PR shows a Lighthouse report URL as a comment.
- Adding 5MB of unused JS to a page makes the workflow fail.
- Baseline metrics section is fully populated.

### Notes

_(fill in as you go)_

---

## Future tightening (post-perf-plan)

After Cloudflare migration tiers ship, revisit:

- Tighten Lighthouse thresholds (after Tier 1: expect perf ≥ 80; after
  Tier 2: expect perf ≥ 95).
- Add E2E to PR previews once Cloudflare Pages provides preview URLs.
- Replace warn-only schema validation in Node with hard failure in dev,
  retain warn-only in prod.
- Add p95 latency SLO based on `Server-Timing` data shipped via Logpush.
