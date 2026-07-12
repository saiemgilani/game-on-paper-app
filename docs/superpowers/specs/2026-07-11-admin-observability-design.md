# Game On Paper — Admin Observability Page: Design

**Date:** 2026-07-11 (retargeted to branch `AE/cloudflare` same day)
**Status:** Approved (design); implementation plan in `docs/superpowers/plans/`
**Target:** branch `AE/cloudflare` — Astro 6 SSR (Cloudflare adapter, Worker runtime) + Flask/gunicorn python + summary service. The vestigial Express app under `node/` is explicitly OUT of scope.

## Goal

A single admin surface to observe and measure everything from backend to frontend:
request latency, ESPN upstream request health, live game processing, errors (server
+ client), performance/memory, IP-level traffic logging — with all telemetry
persisted durably off-box in Postgres on the sdv-data droplet. Visitor analytics
stay with the Plausible Cloud tag that already ships in `GenericPage.astro`.

## Decisions (locked with owner)

| Decision | Choice |
|---|---|
| Target | branch `AE/cloudflare` (Astro SSR frontend; Flask backend; node/ vestigial) |
| Persistence | Postgres on sdv-data droplet, new `gop` schema |
| Transport | Direct PG over TLS from **python only** (`hostssl` + IP-allowlisted, scoped roles); Astro emits via HTTP ingest |
| Dashboard | Custom `/admin` page in Astro + JSON endpoints backed by python SQL |
| Auth | Basic auth (env creds) enforced in Astro middleware for `/admin*` |
| Visitor analytics | Plausible Cloud (tag already present: `data-domain="gameonpaper.com"`) |
| Traffic/IP logging | Server-side `gop.request_log` (ops/security), independent of Plausible |

## Architecture

The Astro frontend runs (now or soon) as a Cloudflare Worker: no long-lived PG
pool, no cross-request in-memory buffer, no background timers. Therefore **the
python service is the single Postgres client** — it keeps the buffered batch
writer, and additionally exposes a secret-guarded ingest endpoint that the Astro
side fires events at, fail-open, one POST per request.

```
browser ──(JS errors, web vitals)──> POST /api/client-log (Astro API route, rate-limited)─┐
Astro middleware (src/middleware.ts): per-request timing/IP/UA/status/outcome ────────────┤ one fire-and-forget
Astro timedFetch wrapper (resources/: espn.ts, internal.ts, summary.ts latency) ──────────┤ POST per request
                                                                                          ▼
                                             python  POST /gop/ingest  (X-GOP-Key shared secret)
                                                          │
python's own after_request + stage timings (espn_fetch, pipeline) ──> in-process ring buffer
                                                          │  batch INSERT (5s / 500 rows, fail-open)
                                                          ▼
                                       gop.* tables @ sdv-data PG (hostssl, allowlisted python-droplet IP)
                                                          ▲
/admin (Astro page, basic auth) ──> /admin/api/* (Astro proxy) ──> python /gop/admin/<name> (SELECT via gop_reader)
```

Rejected alternatives: PG pool inside the Worker (Hyperdrive/nodejs_compat exists
but couples telemetry to CF plumbing and breaks the droplet/dev paths); Workers
Analytics Engine (owner chose PG); a sidecar collector (a new always-on service
for no benefit — python is already the long-lived process).

### Failure semantics (load-bearing)

- **Fail-open everywhere.** The Astro middleware's ingest POST is fire-and-forget
  (`ctx.waitUntil` when available, otherwise unawaited) with a 3 s timeout; a dead
  python or PG must never slow or break a page render. Python's writer buffers
  (cap 5,000, drop-oldest) and flushes every 5 s / 500 rows; a PG outage drops
  batches and increments a counter — never raises into a request.
- Ingest auth: `X-GOP-Key` shared secret (`GOP_INGEST_KEY`); unauthenticated
  posts get 401 and are not buffered. Payloads are validated against the table
  whitelist server-side.

## Data model — `gop` schema (sdv-db repo, `infra/postgresql/03_gop_schema.sql`)

Unchanged from the original design. Roles follow `02_schemas_roles.sql`:
`gop_writer` (INSERT-only), `gop_reader` (SELECT-only).

| Table | Columns (beyond `ts timestamptz NOT NULL DEFAULT now()`) | Written from |
|---|---|---|
| `request_log` | service (`astro`/`python`), method, path, route_pattern, status smallint, duration_ms real, ip inet, ua text, referrer text, game_id text, bytes_out int, cache_status text, render_outcome text (`ok`/`degraded`/`failed`/null), missing_datasets text[] | Astro middleware (via ingest); Flask after_request |
| `upstream_log` | service, target (`espn_pbp`/`espn_scoreboard`/`espn_schedule`/`flask_process`/`summary`/`other`), status smallint, duration_ms real, ok bool, game_id text, error text | Astro `timedFetch` (via ingest); python espn stage |
| `error_log` | service (`astro`/`python`/`client`), level, message, stack, path, game_id, context jsonb | Astro middleware catch + client beacon; Flask except blocks |
| `client_event` | type (`js_error`/`web_vital`), name, value real, path, game_id, ua, ip inet | `/api/client-log` beacon |
| `system_stat` | service, rss_mb real, heap_mb real, cpu_pct real, event_loop_lag_ms real, redis_mem_mb real | python 30 s sampler (python only; Workers have no meaningful process stats) |

- Client IP: `cf-connecting-ip` header first (Worker/CF), then `x-real-ip`
  (nginx), then socket address.
- Retention: daily prune systemd timer on sdv-data (`GOP_RETENTION_DAYS`,
  default 90). Indexes on `ts` and `game_id`. Partitioning deliberately out of
  scope.

## Instrumentation points

### Astro (`astro/src/`)
- **`src/lib/telemetry.ts`** (new): event collector attached to
  `Astro.locals.gop` per request + `sendToIngest(events)` (fetch POST,
  `X-GOP-Key`, 3 s timeout, never throws) + `classifyTarget(url)` +
  `timedFetch(url, init, extra)` — a drop-in `fetch` wrapper that records an
  `upstream_log` event into the current request's collector.
- **`src/middleware.ts`** (new — Astro native `onRequest`): starts the clock,
  creates `locals.gop`, runs `next()`, then assembles `request_log` (+ any
  collected upstream/error events) and fires ONE ingest POST per request via
  `locals.runtime?.ctx?.waitUntil` when present. Also enforces basic auth for
  `/admin` paths (timing-safe compare, `WWW-Authenticate` on 401).
- **Fetch chokepoints wrapped with `timedFetch`:** `resources/espn.ts` (ESPN
  CDN pbp + scoreboard/schedule), `resources/internal.ts` (python
  `/cfb/process`), `resources/summary.ts` (summary service).
- **Client beacon** (`components/Scripts.astro`, `is:inline`, ~30 lines, no
  library): `window.onerror` + `onunhandledrejection` + PerformanceObserver
  LCP/CLS/INP → `POST /api/client-log`. Pageviews remain Plausible's job (tag
  already in `GenericPage.astro`).
- **`src/pages/api/client-log.ts`** (new Astro API route): validates type
  whitelist, per-IP token bucket (per-isolate memory; fail-open), forwards to
  python ingest server-side with the secret.

### Python (`python/`)
- **`telemetry.py`** (new): ring buffer + psycopg batch writer + daemon flush
  thread + 30 s system sampler (/proc VmRSS + process_time) + `stage()`
  contextmanager + `init_flask(app, tel)` request hooks — as in the original
  design.
- **`POST /gop/ingest`** (new Flask route): `X-GOP-Key` check → validate each
  `{table, row}` against the whitelist → `TEL.push`. 202 on success.
- **`GET /gop/admin/<name>`** (new Flask routes): the dashboard's SQL (overview,
  games, upstream, errors, traffic, system, page) via a `gop_reader` psycopg
  connection; guarded by the same `X-GOP-Key`.
- `app.py` wiring: `init_flask`, stage timings around `espn_cfb_pbp()` and the
  pipeline in `process()`, error capture in the existing except blocks.

### Page render outcomes — dataset manifests (degraded vs failed)

The game page declares a **dataset manifest** over the processed-game object
(`retrieveProcessedGame` result): `header`, `plays`, `boxscore` required;
`winprobability`, `pickcenter`, `leaders`, `drives` optional. Evaluation in
`GamePage.astro` after load:

- **`ok`** — everything present.
- **`degraded` (salvageable)** — required present, ≥1 optional missing → page
  renders (neutral `winProbability` backfill guards the template), outcome +
  `missing_datasets` recorded on `locals.gop`.
- **`failed`** — required missing / load threw → existing `Astro.rewrite("/404")`
  behavior preserved, outcome + offending datasets recorded.

This feeds the admin's per-page drill-down: which datasets were missing, how
often, whole-page error vs partially salvageable.

## Admin UI — `/admin` in Astro

- `src/pages/admin/index.astro` — six tabs + per-page drill-down, matching the
  approved mockup (GOP dark tokens, Chivo + Fira Mono). Charts via **Chart.js**,
  which is already an astro dependency (rung: reuse what's installed).
- `src/pages/admin/api/[name].ts` — thin authenticated proxy to python
  `/gop/admin/<name>` (adds `X-GOP-Key`; basic auth already enforced by the
  middleware). Client JS refreshes the active tab every 15 s.
- Tabs: **Overview** (req/min, p50/p95/p99, 5xx rate, ESPN success, telemetry
  dropped counter), **Live games** (per-game req/latency/cache/outcomes; row →
  page detail), **ESPN/upstream** (per-target percentiles + success, failures
  over time, slowest calls), **Errors** (grouped signatures + stacks, client and
  server), **Traffic** (link to Plausible + top routes/IPs/UA classes + web
  vitals p75), **System** (python RSS/CPU series; Astro/Worker stats are N/A and
  the tab says so).
- **Page detail** (`?game_id=`): outcome mix, missing-dataset frequency, related
  errors, latest degraded/failed render — "whole error or salvageable, and what
  exactly was missing."

## Security

- Secrets via env/wrangler secrets only (never committed): `GOP_PG_DSN` +
  `GOP_PG_DSN_RO` (python), `GOP_INGEST_KEY` (astro + python), `ADMIN_USER` +
  `ADMIN_PASS` (astro), `TELEMETRY_ENABLED` (both), existing `PYTHON_HTTP_URL`.
- PG exposure: one `hostssl` line per role for the **python droplet IP** /32 +
  DO firewall rule (runbook in sdv-db; owner-executed). Writer can only INSERT.
- When Astro runs on Workers, python's ingest/admin endpoints are reachable over
  the public internet — they are secret-guarded (`X-GOP-Key`) and return 401
  otherwise; the runbook flags rotating the key alongside admin creds.
- IPs stored raw in the private ops DB; admin UI shows them only on the Traffic
  tab.

## Testing / verification

- Astro: vitest (standard for Astro; added as devDependency) over the pure
  logic — collector, classifyTarget, manifest evaluation, beacon validation,
  basic-auth check. `astro build` must pass.
- Python: pytest via uv (`uv add --dev pytest`) — buffer/flush/drop semantics,
  ingest validation (bad key, bad table), stage timing.
- Local integration: dockerized PG + schema + seed → run Flask locally → hit
  `/gop/admin/*`; `astro dev` against local python → `/admin` renders all tabs;
  beacon and middleware rows land in PG.

## Out of scope (deliberate)

- Instrumenting the vestigial `node/` Express app (it is being replaced by
  Astro; morgan already covers it in the interim).
- Alerting/paging; log-file shipping; partitioning; Grafana; tracing UIs.
- nginx changes (it fronts `node`, not Astro; when nginx is retargeted the
  `x-real-ip` fallback already handles it).

## Deliverables

1. sdv-db: `infra/postgresql/03_gop_schema.sql`, prune SQL + systemd timer,
   pg_hba/firewall runbook (unchanged from original design).
2. `python/telemetry.py` + `/gop/ingest` + `/gop/admin/*` + app.py wiring +
   pytest.
3. `astro/src/lib/telemetry.ts` + `src/middleware.ts` (request log, ingest
   emit, `/admin` basic auth) + `timedFetch` wrapping in the three resources
   modules + vitest.
4. Manifest evaluation + salvage in `GamePage.astro` (+ `src/lib/manifest.ts`).
5. Client beacon in `components/Scripts.astro` + `src/pages/api/client-log.ts`.
6. `/admin` page + `admin/api/[name].ts` proxy (Chart.js, six tabs + drill-down).
7. Env plumbing: astro secrets via the existing `getSecret` pattern (wrangler
   secrets on Workers, `astro/.env` in dev) + python compose env +
   `.env.example` + README section.
