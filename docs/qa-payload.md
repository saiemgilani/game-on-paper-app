# The `qa` payload field

`GET /{league}/{id}/process` carries a `qa` block on every response. It is the
data-quality signal for a live page: Game on Paper has had request telemetry
since PR #165, but nothing that said whether what it served was *right*, so a
wrong live page was invisible until a person looked at it.

This file is the contract. It is written down because the sdv-orch poller
(V3 item 3 of `ClaudeCowork/plans/2026-09-18-data-integrity-and-live-monitoring.md`)
reads it from another repo, and because `/admin#qa` renders it.

Producer: `python/qa.py` (the block) and `python/live_qa.py` (its `live` half).
The field is additive and behind no flag: it is observability, not UI. The
classic game page and every other consumer ignore it.

## Shape

```jsonc
"qa": {
  "ok": true,                 // no error-severity finding anywhere below
  "n_errors": 0,              // null when the deploy has no validation package
  "n_warnings": 3,            // null likewise
  "top_rules": [              // at most 5, errors first, each by size
    { "rule": "score.monotone", "n": 2, "severity": "error" }
  ],
  "contract_ok": null,        // source-contract verdict; null on the ESPN path
  "gop_ok": null,             // ...and whether GOP can render it
  "provenance": {
    "source": "espn",         // the feed that actually produced the game
    "requested": null,        // what ?source= asked for, null when it did not
    "fallback_used": false,   // served != requested
    "sdv_version": "0.1.4",
    "sdv_sha": "7be22b5a"
  },
  "live": {                   // null unless the game is in progress
    "ok": true,               // no ERROR-severity rule fired; anomalies do not move it
    "findings": [],           // error tier: the page we rendered is wrong
    "anomalies": [            // warn/info tier: the source misbehaved
      { "rule": "live.prefix_dropped", "n": 29, "sample": "40186653299", "severity": "warn" }
    ],
    "polls": 7,               // polls this worker has seen for this game
    "since": "2026-09-19T18:02:11+00:00"
  }
}
```

### `qa` itself is null when, and only when, neither half could speak

That is a finished game on a deploy whose `sportsdataverse-py` pin has no
`sportsdataverse.validation` (the gate landed in sportsdataverse-py #553). The
key is always present; `null` is a state, not an absence. A consumer must not
read a null `qa` as "clean".

The two halves fail independently and on purpose:

| | gate (`validate_game`) | live rules (`live_qa`) |
|---|---|---|
| needs | the processor's polars frame **and** a pin carrying `sportsdataverse.validation` | nothing; pure Python over the payload |
| runs on | every game | in-progress games only |
| silent when | the import fails (`n_errors`/`n_warnings` read null, `top_rules` is `[]`) | the game is final or scheduled (`live` is null) |

So a pin without the gate still reports `live`, which is the point: the live
rules are the half that catches a wrong page while it is wrong.

### `top_rules` is a summary, not the report

Five entries at most, errors before warnings, each by the number of rows it
fired on, and no samples. Anything that needs the full `GameReport` calls
`sportsdataverse.validation.validate_game` itself. This block ships on every
response and is stored on every request row, so it has to stay small.

## The live rules

`live_qa.validate_live(prev_summary, curr_payload)` compares one poll with the
one before it. Every rule below is a real failure seen in the captured
timelines under `fixtures/game-states/` (see `docs/game-state-fixtures.md`),
not a hypothetical.

Every rule carries a `severity`, and **only the `error` tier moves `live.ok`**.
Errors go in `findings`, everything else in `anomalies`. Nothing is dropped: an
anomaly is reported with its count and a sample, it just is not a claim that the
page is wrong.

| rule | severity | fires when |
|---|---|---|
| `live.prefix_revised` | info | a finished play changed and the source moved its `modified` stamp. Shield re-revises about eleven plays back |
| `live.prefix_changed` | warn | ...and it did **not** move the stamp: the feed rewrote history silently |
| `live.prefix_dropped` | warn | a finished play is simply gone. ESPN's regressed payloads drop rows rather than rewrite them |
| `live.clock_monotone` | warn | the clock went up inside one period |
| `live.period_monotone` | warn | the period went down |
| `live.score_monotone` | warn | either score went down |
| `live.phase_order` | **error** | the phase went backwards (pregame -> in -> final; halftime is "in", so in <-> halftime is fine) |
| `live.type_null` | **error** | a play has a null `type.id` or `type.text`. `type.abbreviation` is excluded: ESPN ships it null on types that genuinely have none |
| `live.end_state_derived` | **error** | the top row's end state is a copy of its own start on a play that moved |
| `live.wp_continuity` | **error** | win probability moved on a row whose content did not change |
| `live.timeouts_increased` | **error** | a team gained a timeout inside one half |

### Why the split, and what it is worth

Measured by sweeping every rule over the 259 captured games in
`fixtures/game-states` (7,790 poll pairs), before and after:

| | games with `live.ok = false` |
|---|---|
| every rule an error (as first written) | **226 / 259 — 87.3%** |
| severities above | **16 / 259 — 6.2%** |

Per rule, over those 7,790 pairs:

| rule | severity | firings | games |
|---|---|---|---|
| `live.prefix_dropped` | warn | 763 | 170 |
| `live.prefix_revised` | info | 487 | 178 |
| `live.clock_monotone` | warn | 442 | 157 |
| `live.score_monotone` | warn | 407 | 114 |
| `live.period_monotone` | warn | 159 | 81 |
| `live.phase_order` | **error** | 23 | 16 |
| `live.prefix_changed` | warn | 13 | 12 |
| `live.type_null`, `live.end_state_derived`, `live.wp_continuity`, `live.timeouts_increased` | **error** | 0 | 0 |

So the whole 6.2% is `live.phase_order`: a page that said one phase and then an
earlier one. The other four errors never fire on a healthy capture, which is
what an error tier is supposed to look like — and two of them (`wp_continuity`,
`timeouts_increased`) cannot fire here at all, because a raw ESPN capture
carries neither field.

`live.prefix_changed` is `warn` rather than `error` despite being rare: it is
the same event as `prefix_dropped` (the feed rewrote history), differing only in
whether the row was removed or edited, and splitting one phenomenon across two
tiers would make the tier mean nothing.

The counts are all still there. `/admin#qa` shows both tiers in its rule
histogram and only `qa_ok` tells them apart, and a poller that wants to watch
the source's behaviour should alert on an anomaly RATE, not on an anomaly.

### Where the between-poll state lives

In a **bounded in-process dict in the Flask worker** (`live_qa._STATE`, 64
games, oldest evicted), not in a cache or a KV. There is no python-side
processed-game cache to put it in: GOP's caches are all on the Astro side
(Workers Caching and the `ESPN_API_CACHE` KV), which a Flask worker cannot
reach.

Three consequences, all of them sampling rather than correctness — every finding
is still a real pair of real polls:

- **Several workers** (`gunicorn.conf.py`: `workers >= 2`), each with its own
  dict, so a cross-poll rule only fires when two consecutive polls land on the
  same worker, and `polls` counts the polls *that worker* saw.
- **Two threads per worker** (`worker_class = "gthread"`, `threads = 2`) share
  one dict, so `track` does its read-modify-write under a lock. Two concurrent
  polls of one game can still both compare against the same previous summary.
- **Workers recycle** (`max_requests = 400`, jittered), which wipes the dict. So
  `since` resets several times inside one game and `polls` restarts at 1. A
  poller that alerts on "the report stopped changing" must key that on the
  game's own content (period, clock, play count), never on `since` or `polls`.

## Notes for the poller

- **The response may be a cache hit.** A `/process` response can be served from
  Workers Caching, in which case `qa` is the verdict from the poll that filled
  the cache, not from now. `live.since`/`polls` not moving while the clock does
  is itself the stale-cache signal to alert on.
- **`qa` makes the payload vary per request** (`live.polls`, `live.since`).
  That is deliberate and is the one thing about the response that is not a pure
  function of the game.
- **Alert on**: the first `error` on a game (`live.findings`, `qa.ok: false`),
  `gop_ok: false`, a `provenance.fallback_used` flip, and a report that stops
  changing while the clock runs. Do **not** alert per `live.anomalies` entry:
  see the base rates above. Their rate over a slate is worth watching; a single
  one is not.
- **`qa: null` is not clean.** `(resp.json() or {}).get("qa") or {}` turns a
  documented null into an empty dict, after which `qa.get("ok") is False` is
  never true and nothing fires. Treat null as *unmeasured*: count it, and alert
  once per game if a game is never measured while it is live.
- **Rendering `top_rules` into an alert body** wants `f"{r['rule']}×{r['n']}"`,
  not `str(r)` — the entries are dicts.

## Telemetry

`telemetry.py` writes the block onto the same `gop.request_log` row as the
route timing, so "how fast was it" and "was it right" are one sample:
`qa_ok`, `qa_errors`, `qa_warnings`, `qa_source`, `qa_fallback`, and `qa_rules`
(a `text[]` holding the gate's top rule ids and BOTH live tiers' rule ids under
one vocabulary). `qa_errors` / `qa_warnings` are the gate's counts, so they read
null on a pin without it; `qa_ok` is the whole verdict and never does.

DDL: `python/sql/2026-09-19_qa_columns.sql`. Applying it is **not** a deploy
gate: the INSERT names only the columns the live table actually has, probed once
per connection, so the app writes its pre-migration rows unchanged and picks the
qa columns up on its next reconnect afterwards. Running the migration is what
makes `/admin#qa` show anything.

Query: `GET /gop/admin/qa` (`python/gop_routes.py`), which `/admin#qa` renders.
