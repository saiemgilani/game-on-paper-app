# Cloudflare migration plan

Five phases, executed in order. Each phase is independently shippable with a
working rollback. Claude Code can execute most of this autonomously, but
several steps require **user action** (DNS, billing, secrets) — those are
called out explicitly with `> USER ACTION:` blocks. **Do not proceed past a
USER ACTION step without confirmation from the user.**

## Status

- **Phase 0 — Cloudflare CDN in front (Tier 1)**: not started
- **Phase 1 — Quick-win bug fixes**: not started
- **Phase 2 — Worker rewrite + KV + Pages (Tier 2)**: not started
- **Phase 3 — Python on Cloudflare Containers (Tier 3)**: not started
- **Phase 4 — TS + ONNX port (Tier 4, long arc)**: deferred (separate plan)
- Last updated: 2026-04-25

## Resume hint for Claude Code

1. Find the next phase whose status is not "completed" or "deferred".
2. Find the first unchecked task (`☐`) in that phase.
3. **If the task starts with `> USER ACTION:`, stop and ask the user to do
   it. Do not attempt to do it yourself.** Once the user confirms, check the
   task and continue.
4. **If the task is destructive** (DNS cutover, decommissioning the droplet,
   `wrangler deploy --env production`, deleting GH Action secrets), state
   what you're about to do and wait for confirmation, even if the user said
   "continue".
5. After completing all of a phase's tasks, update the Status block above,
   fill in the **Notes** subsection for that phase, and run the **Acceptance**
   checks before moving on.
6. If the user says "continue the migration", start at step 1 with no
   further confirmation needed (subject to rules 3 and 4).

## Cross-references

- The **perf plan** at [perf-plan.md](perf-plan.md) should be at least
  through Day 1 (baseline observability) before starting Phase 0, so the
  CDN's impact can be measured. Day 5 (Lighthouse CI) gates regressions
  during phases.
- After each phase, re-run the Lighthouse CI numbers from perf-plan Day 5
  and tighten thresholds.

## Cost expectations

Realistic monthly bills, assuming current traffic levels (low five-figure
page views/month):

| Phase | Cloudflare | Off-platform | Total delta vs today |
|---|---|---|---|
| 0 | Free plan | unchanged DO droplet | $0 |
| 1 | Free plan | unchanged DO droplet | $0 |
| 2 | Workers Paid ($5) | DO droplet (still running Python) | +$5 |
| 3 | Workers Paid + Containers (~$10–30) | $0 (droplet decommissioned) | -$5 to -$25 vs today |
| 4 | Workers Paid + R2 (~$5) | $0 | savings on container compute |

Containers billing is per-second active CPU/memory; idle is cheap. Confirm
current numbers in Cloudflare's dashboard before Phase 3.

---

## Phase 0 — Cloudflare CDN in front (Tier 1)

**Outcome**: gameonpaper.com proxied through Cloudflare. Static assets cached
at edge. No code changes. Origin still serves everything dynamic.

**Estimate**: 1 day (most is DNS propagation wait time).

**Rollback**: Change nameservers back at the registrar. Propagation 5–30 min
if TTL was lowered beforehand. Site is fully functional during cutover —
this is the lowest-risk phase.

### Tasks

- ☐ Verify perf-plan Day 1 (baseline observability) is complete and baseline
  metrics are recorded in [perf-plan.md](perf-plan.md). If not, do that
  first — there's no point migrating without a before/after.
- ☐ At the current registrar, **lower the TTL on gameonpaper.com NS records
  to 300s** at least 24h before cutover. Quick rollback if anything goes
  wrong.
  > **USER ACTION**: Adjust nameserver TTL at the registrar (Namecheap,
  > Google Domains, etc.). Claude doesn't have registrar access.
- ☐ Verify the origin's TLS posture: `curl -vI https://www.gameonpaper.com
  2>&1 | grep -E 'subject|issuer|TLS'`. If the cert is Let's Encrypt or
  similar valid public CA, "Full (strict)" SSL mode is safe. If it's
  self-signed, plan to use Cloudflare Origin CA (issued for free in dash).
- ☐ Verify the origin can take direct edge traffic on 443 without changes.
  Check the droplet's firewall and any reverse proxy in front of Docker
  (likely nginx or caddy outside this repo).
  > **USER ACTION**: Confirm what's terminating TLS at the droplet. The
  > repo doesn't include a reverse proxy config — this lives outside the
  > Docker compose. Document it in this plan's Notes section.
- ☐ Create Cloudflare account, add gameonpaper.com as a site (Free plan is
  fine for Phase 0).
  > **USER ACTION**: Sign up at cloudflare.com and add the domain.
  > Cloudflare auto-imports existing DNS records.
- ☐ Verify imported DNS records match the current set: A/AAAA for `@` and
  `www` should point to the droplet IP. Adjust if the import missed
  anything (mail records, txt verification, etc.).
- ☐ At the registrar, change nameservers to the two Cloudflare NS records
  shown in the dashboard.
  > **USER ACTION**: Change NS at registrar.
- ☐ Wait for propagation. Verify with `dig NS gameonpaper.com` from a
  non-cached resolver (`dig @1.1.1.1 NS gameonpaper.com`).
- ☐ In Cloudflare dashboard, enable proxy (orange cloud) on `@` and `www`
  records.
- ☐ **SSL/TLS** → set to "Full" first. After confirming site loads, switch
  to "Full (strict)" if origin cert is valid.
- ☐ **Speed** → enable Brotli, HTTP/3, 0-RTT. **Caching** → enable Tiered
  Cache.
- ☐ **Cache Rules** (in order; first match wins):
  1. `URI Path starts with /assets/` → **Cache Eligibility: Eligible for
     cache; Edge TTL: 1 hour; Browser TTL: 1 day.** (Bumped to 1 year in
     Phase 2 once asset hashing is in place.)
  2. `URI Path equals /robots.txt` → Edge TTL 1 day.
  3. `URI Path matches /cfb/year/*/teams/*` AND `Method eq GET` → Edge TTL
     5 min, Browser TTL 1 min. (Updates daily via summary service.)
  4. `URI Path matches /cfb/teams/*` (no year prefix; redirects) → Edge TTL
     5 min.
- ☐ **Page Rules / WAF** → migrate the bot UA blocklist from
  [frontend/server.js:17-26](../frontend/server.js) to a WAF custom rule
  (Block requests where User-Agent contains any of the listed strings).
  Removes the null-check bug at [server.js:29](../frontend/server.js) as a
  side effect.
- ☐ Spot-check: hit `/assets/css/index.css` twice via curl, second response
  should have `cf-cache-status: HIT`. Hit `/cfb/game/401403910`, verify
  page still renders correctly.
- ☐ After 24h, capture new metrics in perf-plan's Baseline section under a
  new "After Phase 0" heading.

### Acceptance

- `dig NS gameonpaper.com @1.1.1.1` returns Cloudflare NS records.
- `curl -I https://www.gameonpaper.com/assets/css/index.css` shows
  `cf-cache-status: HIT` on the second request.
- Lighthouse CI from perf-plan Day 5 shows improved LCP and total byte
  weight, with passing thresholds.
- Origin egress (visible in DigitalOcean dashboard) drops noticeably.

### Notes

_(fill in as you go: registrar used, TTL chosen, TLS mode, what's
terminating TLS at origin, propagation duration, post-Phase 0 metrics)_

---

## Phase 1 — Quick-win bug fixes

**Outcome**: Existing services run faster and more correctly with no
architectural changes. Independent of Cloudflare — could be done before
Phase 0, but ordering after means the Phase 0 baseline reflects today's
broken state and the wins are clearly attributable.

**Estimate**: 1–3 days.

**Rollback**: `git revert` per fix. Each fix is a separate commit.

### Tasks

#### Python service

- ☐ Add `gunicorn` to [python/requirements.txt](../python/requirements.txt).
- ☐ Change [python/Dockerfile](../python/Dockerfile) `CMD` to:
  `gunicorn -w 2 -k gthread --threads 8 --timeout 120 -b 0.0.0.0:7000 app:app`.
  (Two workers because the 4GB memory limit splits to 2GB each — pandas
  pipelines are memory-hungry. Tune after observing.)
- ☐ Add `flask-compress` to requirements; in [python/app.py](../python/app.py)
  apply `Compress(app)` after creating the Flask app. PBP responses are
  multi-MB JSON that compress 5–10×.
- ☐ Replace the `KeyError → 404` blanket catch at
  [python/app.py:260-269](../python/app.py) with explicit handling for the
  *expected* missing-key case (ESPN returning a malformed payload — usually
  detectable by `pbp["header"]` being absent) and re-raise everything else
  to the 500 handler. Stops masking real bugs.

#### Node frontend

- ☐ `cd frontend && npm i compression`. In
  [frontend/server.js](../frontend/server.js) add
  `app.use(compression())` before the static handler. EJS responses are
  100KB+ and compress 80–90%.
- ☐ Fix the User-Agent null crash at [server.js:29](../frontend/server.js):
  `req.get('User-Agent')?.toLocaleLowerCase()?.match(...)` (optional
  chaining + nullish handling). Or delete the middleware entirely once
  Phase 0 moved the rule to WAF.
- ☐ Fix the broken POST handler at
  [frontend/cfb/routes.js:490](../frontend/cfb/routes.js): change
  `Games.getPBP(req, res)` → `Games.getPBP(req.params.gameId)`.
- ☐ Replace SET+EXPIRE pairs in [routes.js](../frontend/cfb/routes.js) and
  [games.js](../frontend/cfb/games.js) (lines 110-111, 141-142, 184-185,
  233-234, 295-296) with `redisClient.set(key, val, { EX: ttl })`. Atomic
  + one round trip.
- ☐ Cap the recursive year fallback at
  [routes.js:121, 195, 246](../frontend/cfb/routes.js): currently any
  transient axios failure on the summary service triggers up to 11
  recursive retries. Add a retry counter (max 2) and an explicit
  "service unavailable" path for the rest.
- ☐ Set `maxmemory-policy allkeys-lru` (or `allkeys-lfu`) on
  [redis/cache.conf](../redis/cache.conf). Currently it has no eviction
  policy and returns OOM on overflow.
- ☐ `cd frontend && npm i axios@^1` to upgrade past CVE-vulnerable 0.21.1.
  Verify the PBP and ESPN axios calls still work.

#### Asset cleanup

- ☐ Delete `frontend/public/assets/js/bootstrap.{esm,esm.min,bundle,js,bundle.min,min}.js.map`
  and the duplicate non-min variants. Keep only
  `bootstrap.bundle.min.js` and its map (or delete the map too in prod).
- ☐ Same for `bootstrap.css.map`, `bootstrap-grid.*.map`, etc. in
  [frontend/public/assets/css](../frontend/public/assets/css).
- ☐ Replace the 1.1MB `favicon.svg` with a properly-sized SVG (target
  <50KB) or remove the SVG link and rely on the existing `.ico`/PNGs.
- ☐ Verify total `frontend/public/` size dropped from ~17MB to ~3MB.
- ☐ `git add -p` and commit each fix separately so Phase 0's CDN
  improvements vs Phase 1's code improvements are distinguishable in
  metrics later.

### Acceptance

- `pytest python/tests -m "not integration"` still passes (perf-plan Day 2
  must be done; otherwise nothing catches regressions in the Python reshape).
- Manually verify: live game page renders, scoreboard renders, leaderboard
  renders. Playwright suite (perf-plan Day 3) passes.
- `du -sh frontend/public` shows ~3MB or less.
- Server-Timing headers on game page show `pipeline` time roughly halved
  (gunicorn lets a second request actually parallelize against the first).

### Notes

_(fill in as you go: gunicorn worker count chosen, any tests that broke
during the cleanup, redis OOM observations)_

---

## Phase 2 — Worker rewrite + KV + Pages (Tier 2)

**Outcome**: Express + EJS replaced by a Cloudflare Worker. Static assets
served from Cloudflare Pages or Workers Static Assets. Redis (LRU) replaced
by KV. Per-game cache lives in the Cache API. Droplet still runs the Python
service only.

**Estimate**: 2–3 weeks.

**Rollback**: DNS-level. Keep the droplet running the full stack throughout
this phase. Cut over via DNS only at the end. If anything breaks, switch
gameonpaper.com proxy back to the droplet origin via Cloudflare's load
balancer or a single DNS edit.

### Sub-phases

#### 2A — Scaffolding

- ☐ Decide on framework. Recommendation: **Hono** (Express-like, designed
  for Workers). Alternatives: itty-router (smaller), plain Workers
  (no router). Document the choice in Notes.
- ☐ Create `worker/` directory at repo root with
  `package.json`, `wrangler.toml`, `tsconfig.json`, `src/index.ts`. Use
  TypeScript — the EJS files contain enough untyped data shaping to make
  TS payback fast.
- ☐ `cd worker && npm i hono`. Dev tools: `npm i -D wrangler typescript
  @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers`.
  > **USER ACTION**: Create a Cloudflare API token (Account → API Tokens
  > → Create → "Edit Cloudflare Workers" template). Save as a
  > `CLOUDFLARE_API_TOKEN` GitHub secret and a local `~/.wrangler/config`
  > entry.
- ☐ Configure `wrangler.toml` with `name = "gameonpaper"`, `main =
  "src/index.ts"`, `compatibility_date`. Add `nodejs_compat` flag (some
  npm packages assume Node built-ins).

#### 2B — Port routes incrementally

The current Express app has these route groups in
[routes.js](../frontend/cfb/routes.js):

- `/cfb/` — scoreboard
- `/cfb/year/:year/type/:type/week/:week` — week scoreboard
- `/cfb/year/:year` — year scoreboard
- `/cfb/game/:gameId` — game detail (the big one)
- `/cfb/year/:year/team/:teamId` — team season
- `/cfb/team/:teamId` — team overview
- `/cfb/teams/:type` and `/cfb/year/:year/teams/:type` — leaderboard
- `/cfb/year/:year/players/:type` — player leaderboard
- `/cfb/year/:year/charts/team/epa` — EPA chart
- `/cfb/charts/trends` — trends chart
- `/cfb/glossary` — static
- Various redirects

Port in this order (simplest first, biggest at the end):

- ☐ `/cfb/glossary` — static-ish, just renders the glossary JSON. Validates
  the templating approach works.
- ☐ Static redirects (`/cfb/teams`, `/cfb/players`, etc.).
- ☐ `/cfb/year/:year/teams/:type` (leaderboard) — exercises KV reads from
  the summary service.
- ☐ `/cfb/year/:year/players/:type` (player leaderboard).
- ☐ `/cfb/charts/trends`, `/cfb/year/:year/charts/team/epa`.
- ☐ `/cfb/team/:teamId`, `/cfb/year/:year/team/:teamId`.
- ☐ `/cfb/` (scoreboard) — exercises ESPN scoreboard fetch + Cache API.
- ☐ `/cfb/year/:year/type/:type/week/:week`, `/cfb/year/:year`.
- ☐ `/cfb/game/:gameId` — the big one. Exercises ESPN PBP fetch, Python
  service call, percentile lookup, error/quarantine handling, and the
  100KB game.ejs render.

For each route:
- Translate Express handler → Hono handler.
- Translate EJS template → JSX (or keep EJS via `eta` template engine,
  which works in Workers; but JSX is easier to maintain).
- Replace `axios` with `fetch`.
- Replace Redis reads with KV reads, Redis writes with KV writes.
- Replace `req.query.foo` patterns with Hono's `c.req.query('foo')`.

#### 2C — KV namespaces

- ☐ `wrangler kv namespace create LEAGUE_DATA` — replaces the LRU Redis.
  Keys: `${year}-${type}` (e.g. `2024-overall`), `${year}-percentiles-${pctile}`.
  TTL via the `expirationTtl` param on writes (3 days).
- ☐ `wrangler kv namespace create SUMMARY_LAST_UPDATED` (small, but isolate
  from the bulk data so list operations stay fast).
- ☐ Add the bindings to `wrangler.toml`:
  ```toml
  [[kv_namespaces]]
  binding = "LEAGUE_DATA"
  id = "..."
  ```
- ☐ Migrate the recursive-fallback summary fetch to a single KV-with-fetch
  pattern: `kvCacheOr(key, ttl, () => fetchSummary(...))`.

#### 2D — Cache API for per-game PBP

- ☐ Replace the per-game Redis (port 6380) with `caches.default` keyed by
  the request URL. For completed games, use `Cache-Control: public,
  max-age=86400, s-maxage=31536000` (browser 1 day, edge 1 year). For
  in-progress games, `s-maxage=30`. Determined by checking
  `gameInfo.status.type.completed`.
- ☐ Implement the `QUARANTINE_LIST` check (currently
  [routes.js:395-407](../frontend/cfb/routes.js)) inside the Worker and
  return the same `game_error` template, with `errorType: 'quarantine'`.

#### 2E — Static assets

Two options, pick one:

- **Option A (recommended)**: Workers Static Assets binding. Simpler — one
  Worker, one deploy.
  - ☐ Move `frontend/public/*` to `worker/public/*`.
  - ☐ Add `[assets] directory = "./public"` to `wrangler.toml`.
  - ☐ Reference assets as normal `/assets/...` paths; Worker serves them
    automatically with proper Content-Type.
- **Option B**: Cloudflare Pages for static assets, Worker for routes.
  More moving parts; only choose if you want CI/CD per-PR previews
  separately for assets.

- ☐ Either way, hash filenames (e.g. via a simple build script or
  `vite-plugin-cloudflare`) so the Phase 0 1-hour cache TTL can be bumped
  to 1 year `immutable`.
- ☐ Update Phase 0 Cache Rule for `/assets/*` to **Edge TTL 1 year, Browser
  TTL 1 year**.
- ☐ Replace asset references in templates with hashed filenames.

#### 2F — Cron-warmed scoreboard

- ☐ Add a Cron Trigger to `wrangler.toml`:
  ```toml
  [triggers]
  crons = ["* * * * *"]
  ```
  (every minute; tune down to 30s if needed via two crons offset).
- ☐ In the Worker `scheduled` handler, fetch the ESPN scoreboard and write
  it to KV with key `cfb-scoreboard`. The user-facing `/cfb/` route reads
  from KV first, only falls back to a live fetch if KV is empty.
- ☐ Consider a window guard: only run the cron during football season
  (`now >= Aug 20 && now <= Jan 20`) to save executions.

#### 2G — Tests + observability

- ☐ Vitest tests (using `@cloudflare/vitest-pool-workers`) for:
  - `retrieveGameList` sort logic
  - `calculateGEI` (currently in [games.js:166](../frontend/cfb/games.js))
  - The recursive-fallback cap (asserts max 2 retries, hits 2014 floor)
  - QUARANTINE_LIST routing
- ☐ Carry forward the Server-Timing instrumentation from
  perf-plan Day 1 — every Worker response should have it. Use
  `c.res.headers.set('Server-Timing', ...)`.
- ☐ Carry forward structured JSON logging — in Workers, just
  `console.log(JSON.stringify({...}))`. Workers Logs surfaces this in the
  dashboard.
- ☐ Update the JSON Schema contract validator from perf-plan Day 4 to run
  in the Worker against Python responses.
- ☐ Update Playwright E2E suite to point at preview URLs — every Worker
  deploy via PR gets a unique `*.workers.dev` URL. Update
  `.github/workflows/e2e.yml` to use the preview URL for PR runs.

#### 2H — Parallel deploy + cutover

- ☐ Deploy the Worker to a `staging.gameonpaper.com` subdomain (or use
  the auto-generated `*.workers.dev` URL).
- ☐ Run full Playwright suite against staging.
- ☐ Manually click through every page type, comparing side-by-side with
  the production droplet.
- ☐ Capture pre-cutover metrics (Lighthouse, CF Web Analytics, Server-
  Timing). Save in this plan's Notes.
- ☐ **Cutover**: in Cloudflare DNS, change the `@` and `www` records from
  the droplet IP to a Workers route (`gameonpaper.com/*` →
  `gameonpaper-worker`). The Worker now handles all traffic.
  > **DESTRUCTIVE STEP**: confirm with user before cutting over. Have a
  > rollback DNS edit ready (revert to droplet IP) — under 30 seconds to
  > apply.
- ☐ Monitor for 24h. Watch error rate in Workers Analytics, watch
  `cf-cache-status` distribution.
- ☐ Capture post-cutover metrics. Compare with pre-cutover.

### Acceptance

- `gameonpaper.com` serves traffic from the Worker (verify via
  `cf-ray` header).
- All Playwright E2E tests pass against production Worker.
- Lighthouse perf score on game page is ≥85 (was ~50 baseline).
- Workers Logs shows structured JSON logs with Server-Timing-equivalent
  fields.
- Droplet still running, but Cloudflare DNS no longer points at it
  except for the Python service (handled in Phase 3).

### Notes

_(fill in as you go: framework chosen, KV namespace IDs, asset strategy,
preview URLs used for testing, rollback events if any, before/after metrics)_

---

## Phase 3 — Python on Cloudflare Containers (Tier 3)

**Outcome**: Python `/cfb/process` runs as a Cloudflare Container bound to
the Worker. Droplet decommissioned. Both Redis containers gone (replaced by
KV/Cache API in Phase 2). One bill.

**Estimate**: 1–2 weeks.

**Rollback**: Keep the droplet running until end of phase. The Worker can
be flipped back to calling the droplet's Python URL via a single env var
edit and `wrangler deploy`.

### Sub-phases

#### 3A — Image audit

- ☐ Confirm Cloudflare Containers is available on the account
  (Workers Paid plan required, plus Containers eligibility — check
  dashboard or `wrangler containers list`).
  > **USER ACTION**: Confirm Containers access. Pricing is per-second
  > active CPU; idle is cheap. Estimate based on current Python service
  > traffic.
- ☐ Audit the Python image: ensure gunicorn is in (Phase 1). Verify the
  image runs on `linux/amd64` (Cloudflare Containers requirement). Test
  with `docker run --platform linux/amd64 ghcr.io/.../game-on-paper-python`.
- ☐ Add a `/healthcheck` Server-Timing assertion: it should be <50ms
  (cold start excluded). If it isn't, the container init is doing too
  much — investigate before deploying.
- ☐ Push the image to a registry Cloudflare can pull from. Options:
  - GitHub Container Registry (GHCR) with public visibility.
  - Cloudflare's own registry (preferred — no auth dance for Workers).
  > **USER ACTION**: Choose registry strategy. If sticking with GHCR,
  > make sure the image is public or set up registry creds in Cloudflare
  > dashboard.

#### 3B — Container binding

- ☐ Add to `wrangler.toml`:
  ```toml
  [[containers]]
  name = "PBP_PROCESSOR"
  image = "ghcr.io/saiemgilani/saiemgilani/game-on-paper-python:latest"
  instance_type = "basic"  # adjust based on memory needs
  max_instances = 5
  ```
- ☐ Update the Worker's PBP fetch path: replace
  `fetch(env.PYTHON_BASE_URL + '/cfb/process', ...)` with
  `env.PBP_PROCESSOR.fetch('http://container/cfb/process', ...)`.
- ☐ Add an env-controlled toggle so traffic can be split: e.g.,
  `PYTHON_BACKEND=container|droplet`. Lets you A/B during cutover.

#### 3C — Parallel deploy

- ☐ Deploy Worker with `PYTHON_BACKEND=container` to a preview environment.
- ☐ Run the full Playwright suite against the preview. Particular attention
  to: cold start latency, in-progress game refresh, and the OT/quarantine
  fixtures from perf-plan Day 2.
- ☐ Compare snapshot test outputs (perf-plan Day 2) between droplet Python
  and container Python — should be identical (same image).
- ☐ If using `instance_type = "basic"`, monitor memory: pandas pipelines
  routinely peak above 1GB. Bump to `standard` if OOMs occur.

#### 3D — Production cutover

- ☐ Set `PYTHON_BACKEND=container` in production.
- ☐ Deploy: `wrangler deploy --env production`.
  > **DESTRUCTIVE STEP**: confirm with user. Have rollback ready
  > (`PYTHON_BACKEND=droplet` + redeploy, ~60s).
- ☐ Monitor for 48h: error rate, p50/p95 of `/cfb/process` calls (visible
  in Server-Timing logs and Workers Analytics), container instance count,
  memory usage.
- ☐ Once stable, remove the toggle and the droplet URL config.

#### 3E — Decommission droplet + Redis containers

- ☐ Verify nothing in production points at the droplet
  (`dig www.gameonpaper.com`, check Cloudflare DNS).
- ☐ Stop the droplet (don't delete yet — keep as cold-storage rollback for
  1 week).
  > **USER ACTION**: Stop the droplet via DigitalOcean dashboard. Claude
  > shouldn't have DO API access.
- ☐ One week later, after confirming stable production: destroy the
  droplet, delete the deploy SSH keys, archive the
  `.github/workflows/deploy.yml` file (move to
  `.github/workflows/deploy.yml.archived`).
- ☐ Update [README.md](../README.md): remove "Make sure you have Docker
  installed... `docker compose up`" instructions; add new "Local dev:
  `cd worker && wrangler dev`" instructions.
- ☐ Archive [docker-compose.yml](../docker-compose.yml) and
  [docker-compose.do.yml](../docker-compose.do.yml) to a
  `legacy/` directory or delete (git history preserves them).
- ☐ Delete the Redis Dockerfiles ([redis/Dockerfile.cache](../redis/Dockerfile.cache),
  [redis/Dockerfile.lru](../redis/Dockerfile.lru), and the .conf files).
- ☐ Update [CLAUDE.md](../CLAUDE.md) to reflect the new architecture.

### Acceptance

- Production traffic served entirely by Worker + Container; no droplet
  involvement.
- p95 latency on `/cfb/game/:id` cache miss is comparable to or better
  than droplet-era numbers.
- Lighthouse perf score on game page is ≥90.
- Single deploy command (`wrangler deploy`) replaces SSH + docker compose.
- Total monthly bill is lower than droplet-era.

### Notes

_(fill in as you go: instance_type chosen, max_instances, registry chosen,
cutover timeline, post-cutover metrics, decommission date, anything that
broke during container migration)_

---

## Phase 4 — TS + ONNX port (Tier 4) — DEFERRED

**Outcome**: The Python pipeline (data cleaning + XGBoost inference) is
re-implemented in TypeScript using `onnxruntime-web`. No Python in
production. Container removed. Edge-only architecture.

**Why deferred**: This is months of engineering. Realistic only after
Phase 3 is stable for at least a quarter, and only if container compute
costs become a real budget concern OR the cache miss latency on live
games matters at higher traffic.

When the time comes, build a separate `docs/onnx-port-plan.md` with phases
for:

1. Export EP, WP, QBR XGBoost models to ONNX. Verify inference parity in a
   notebook against the Python pipeline output.
2. Move ONNX artifacts to R2.
3. Port `create_box_score` first — it's pure aggregation, no inference.
4. Port the inference call sites with `onnxruntime-web` running in WASM.
5. Port the data-cleaning pipeline (~6000 lines of pandas) incrementally,
   covered by the Day 2 snapshot tests at every step.
6. Decommission the container.

Until that plan is built, leave Phase 4 deferred and revisit annually.

---

## Glossary of decisions deferred to Notes

These show up across multiple phases and need to be documented as soon as
they're made:

- **What terminates TLS at the droplet today** (Phase 0).
- **Cloudflare API token name + permissions used** (Phase 2).
- **Hono vs alternatives for Workers framework** (Phase 2A).
- **Workers Static Assets vs Pages for static files** (Phase 2E).
- **Container instance_type and max_instances chosen** (Phase 3B).
- **Registry used for the Python image** (Phase 3A).
