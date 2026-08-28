# GOP performance + telemetry review — 2026-08-27

Source: `gop` schema on sdv-data, 4 days of production traffic (2026-08-23 →
08-27), 82k requests. All numbers are 24h unless stated.

## 1. Is the admin panel collecting correctly?

Yes, with gaps now closed. Volumes are healthy and fresh to the second:

| table | rows | note |
|---|---|---|
| request_log | 81,935 | every non-asset request |
| upstream_log | 59,881 | ESPN + python + SDV API calls |
| system_stat | 48,264 | was per-worker only; host rows added |
| client_event | 7,261 | web vitals + JS errors |
| error_log | 78 | server + client exceptions |

Gaps found and fixed this session:

- `cache_status` was **100% null** and `bytes_out` **85% null** — `emit()`
  never received the response object. Now populated from `content-length` and
  the `cache-control` the app set. An edge cache HIT never reaches the Worker,
  so hit/miss is not observable there; we record caching *intent*.
- `system_stat` sampled `/proc/self/status` — one worker, not the host. A
  `python-host` row now carries loadavg normalised to core count, host memory
  and core count.
- SDV data-API calls (6,570/day) were bucketed as `other`, so the load the
  site puts on sdv-db was invisible. Now classified `sdv_api`.
- Nothing measured the database itself. `gop.db_stat` is now sampled every
  minute *on* the sdv-data droplet (see §5).

## 2. The bottleneck: python game processing

`/game/[id]` is the flagship page and its tail is bad.

| route | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| `/game/[id]` | 1,753 | 7.1 s | 25.3 s | 57.3 s | 78.2 s |
| `/year/[year]/team/[id]` | 2,705 | 1.6 s | 3.9 s | 6.3 s | 45.7 s |
| `/game/matchup` | 552 | 1.5 s | 2.5 s | 3.2 s | 5.4 s |

Essentially all of it is one upstream call:

| upstream | n | p50 | p95 | max | fails |
|---|---|---|---|---|---|
| `flask_process` | 1,645 | 6.3 s | 25.6 s | 77.5 s | 1 |
| `espn_team` | 2,967 | 345 ms | 1.2 s | 7.0 s | 3 |
| `espn_pbp` (astro) | 1,753 | 653 ms | 1.4 s | 3.2 s | **104** |
| `espn_pbp` (python) | 1,645 | 121 ms | 387 ms | 1.8 s | 0 |
| `sdv_api` (was `other`) | 6,570 | 102 ms | 1.0 s | 8.4 s | 0 |

The ESPN fetch inside python is 121 ms. The remaining ~7.5 s is
`run_processing_pipeline()` — the EPA/WP model work. That is the bottleneck,
not the network and not the database.

## 3. Load limits

Latency degrades linearly with concurrency, which is the signature of
queueing rather than slowness:

| concurrent flask calls | n | avg | p95 |
|---|---|---|---|
| 1–2 | 1,446 | 7.7 s | 17.5 s |
| 3–4 | 53 | 15.4 s | 25.2 s |
| 5–8 | 56 | 21.0 s | 43.6 s |
| 9–16 | 72 | 25.8 s | 57.6 s |
| 17+ | 46 | 46.6 s | 74.4 s |

Peak observed concurrency was **29** against **8** gunicorn slots
(`workers=4`, `gthread`, `threads=2`).

Capacity math. Service time is ~7.7 s of mostly CPU-bound Python, so the two
threads per worker buy almost nothing — the GIL serialises them, and only the
121 ms ESPN fetch overlaps. Effective parallelism is therefore ~4, not 8:

    ceiling ≈ 4 workers / 7.7 s ≈ 0.52 games/s ≈ **~31 game-processes/minute**

The data agrees: the busiest minutes (26–32 calls) show 50 s averages. Above
~30/min the queue grows without bound.

**Season risk.** Today's 1,673 python calls/day is ~1/min. A Saturday slate
concentrating 10× traffic into a 6-hour window is ~46/min — past the ceiling.
Expect 60 s+ game pages on the first big Saturday unless the work per request
drops or the cache starts absorbing it.

## 4. Cache works; crawlers are the real load

An earlier read of this data claimed a 94% cache pass-through. That was wrong,
and the correction matters. `request_log` only ever contains requests that
reached the Worker, and an edge HIT never does — so page-views vs python-calls
in that table is ~1:1 by construction and says nothing about cache health.
Measured directly instead, the cache is fine:

    /game/401752921  MISS -> HIT -> HIT        (completed game, 1y TTL)
    /game/401867894  HIT age=73                (live game, short TTL)

The real driver of expensive work is *who* is asking. Over 48h of game-page
requests:

| requester | requests | distinct games |
|---|---|---|
| **bots/crawlers** | **1,963 (59%)** | 1,170 |
| human desktop | 1,113 | 565 |
| human mobile | 238 | 124 |

MJ12bot alone walked 400 distinct games from one IP. A distinct game is a cache
miss by definition, so each one costs a full ~7.5s computation. The 07:39
burst (34 calls / 34 distinct games in one minute) came from Tor exit nodes
(185.220.101.x, 192.42.116.x) spoofing an old-Android UA.

`robots.txt` disallowed only `/cfb/` — the pre-Astro URL layout — leaving
`/game/*` wide open. Fixed in f776a4a.

Duplicate concurrent work on the *same* game is only 204 of 3,071 calls
(6.6%), and the busy minutes are 34 calls across 34 distinct games. So the
load is breadth, not a thundering herd, and single-flight coalescing is a
small win not worth new concurrency primitives mid-season. Revisit if that
share grows.

## 5. Database and volume strain

Sampled minutely into `gop.db_stat` from the sdv-data droplet:

| metric | value | verdict |
|---|---|---|
| cache hit ratio | **87.7%** | low; want >99% |
| connections | 16 / 100 | fine |
| load1 | 0.34 on 8 cores | idle |
| database size | 133 GB | — |
| gop schema | 28 MB (~7 MB/day, 90-day prune → ~630 MB) | negligible |
| volume free | 267 GB of 1.6 T (82% used) | watch |

`shared_buffers` is 4 GB against a 133 GB database on a 31 GB host, which
explains the 87.7%. The database is **not** today's bottleneck — but it is now
measured rather than assumed. `pg_stat_statements` is not installed, so slow
queries remain invisible; that is the highest-value remaining addition.

## 6. Errors and noise

- **8,637 404s/day are DigitalOcean uptime probes** hitting `/api/v2/healthcheck`
  and `/cfb/healthcheck`, neither of which exists (the real one is
  `/healthcheck`). Five probe IPs, one per minute each. Either the monitor has
  been alerting all along or it is silently green on a 404 — both are bad. This
  is 55% of all logged traffic and it distorts every status-mix chart.
- ~600/day are WordPress vulnerability scanners. Normal internet noise.
- Real user traffic is ~9,500 requests/day.
- **104 ESPN pbp failures** (5.9% of astro's fetches) — retry/backoff worth adding.
- 16 × 500 on `/team/[id]` — fixed in 96dc160 (see §7).
- Web vitals are good: LCP p75 1.08 s, INP p75 88 ms, CLS 0.01. One LCP sample
  of 20,256 s (5.6 h) should be clamped; it is a backgrounded tab, not a page load.

## 7. Front-end defects found and fixed

- **Teams with no ESPN colour** (`96dc160`). ESPN omits `color` for LIU (2341),
  West Florida (110242) and most non-FBS schools, but the type declared
  `color: string`, so nothing warned. Three call sites called `.startsWith` on
  it: `/team/[id]` threw server-side (the 500s above), DriveChart threw during
  hydration (the chart silently failed to render), and `markPlay` painted the
  literal `#undefined`. One `teamColorHex()` helper now normalises all of them.
  Scanning live FCS games: **4 of 22 had a colourless team**, and **20 of 20
  games with drives had a drive whose team carried no colour** — this was
  firing constantly, not rarely.

## 8. Recommended next actions, in order of value per unit of work

1. **Fix the uptime probe URL** to `/healthcheck`. Minutes of work; removes 55%
   of logged traffic and restores meaningful alerting.
2. ~~Add a short shared cache~~ — **done differently.** The cache already
   works; the load was crawlers. `robots.txt` now blocks the parasitic ones
   (f776a4a), which removes most of the 59% bot share of game-page computes.
3. **Re-tuned gunicorn** (f776a4a): worker count is derived at boot from CPU
   affinity and clamped by MemTotal at ~600 MB/worker, instead of a hardcoded
   4 x 2 threads that advertised 8 slots and delivered ~4. Still worth doing:
   `preload_app` would share model memory via copy-on-write, but it needs
   `TEL.start()` moved into a `post_fork` hook first — the flush thread does
   not survive a fork, so preloading today would silently stop telemetry.
4. **Profile `run_processing_pipeline()`.** The 7.7 s floor sets everything
   else. Halving it doubles the ceiling.
5. **Install `pg_stat_statements`** for query-level visibility.
6. **Retry/backoff on ESPN pbp fetches** (5.9% failure rate).
7. **Raise `shared_buffers`** toward 8 GB and re-measure cache hit ratio.
