# The `qa` payload field

`GET /{league}/{id}/process` carries a `qa` block on every response. It is the
data-quality signal for a live page: Game on Paper has had request telemetry
since PR #165, but nothing that said whether what it served was *right*, so a
wrong live page was invisible until a person looked at it.

This file is the contract. It is written down because the sdv-orch poller
(V3 item 3 of `ClaudeCowork/plans/2026-09-18-data-integrity-and-live-monitoring.md`)
reads it from another repo, and because `/admin/qa` renders it.

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
    "ok": true,
    "findings": [ { "rule": "live.prefix_dropped", "n": 29, "sample": "40186653299" } ],
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

| rule | fires when |
|---|---|
| `live.prefix_changed` | a finished play's content changed and the source did **not** move its `modified` stamp |
| `live.prefix_revised` | ...and it did. **Counted, never failed**: Shield legitimately re-revises about eleven plays back |
| `live.prefix_dropped` | a finished play is simply gone. ESPN's regressed payloads drop rows rather than rewrite them |
| `live.clock_monotone` | the clock went up inside one period |
| `live.period_monotone` | the period went down |
| `live.phase_order` | the phase went backwards (pregame -> in -> final; halftime is "in", so in <-> halftime is fine) |
| `live.score_monotone` | either score went down |
| `live.type_null` | a play has a null `type.id` or `type.text`. `type.abbreviation` is excluded: ESPN ships it null on types that genuinely have none |
| `live.end_state_derived` | the top row's end state is a copy of its own start on a play that moved |
| `live.wp_continuity` | win probability moved on a row whose content did not change |
| `live.timeouts_increased` | a team gained a timeout inside one half |

`ok` is false when any rule outside `live_qa.COUNTERS` fired.

### Where the between-poll state lives

In a **bounded in-process dict in the Flask worker** (`live_qa._STATE`, 64
games, oldest evicted), not in a cache or a KV. There is no python-side
processed-game cache to put it in: GOP's caches are all on the Astro side
(Workers Caching and the `ESPN_API_CACHE` KV), which a Flask worker cannot
reach.

The consequence to know: gunicorn runs several workers and each keeps its own
dict, so `polls` counts the polls **that worker** saw, and a cross-poll rule
only fires when two consecutive polls land on the same worker. That is a
sampling rate, not a correctness problem — every finding is still a real pair
of real polls — but a poller must not read `polls` as the game's poll count.

## Notes for the poller

- **The response may be a cache hit.** A `/process` response can be served from
  Workers Caching, in which case `qa` is the verdict from the poll that filled
  the cache, not from now. `live.since`/`polls` not moving while the clock does
  is itself the stale-cache signal to alert on.
- **`qa` makes the payload vary per request** (`live.polls`, `live.since`).
  That is deliberate and is the one thing about the response that is not a pure
  function of the game.
- **Alert on**: the first error on a game, `gop_ok: false`, a
  `provenance.fallback_used` flip, and a report that stops changing while the
  clock runs.

## Telemetry

`telemetry.py` writes the block onto the same `gop.request_log` row as the
route timing, so "how fast was it" and "was it right" are one sample:
`qa_ok`, `qa_errors`, `qa_warnings`, `qa_source`, `qa_fallback`, and `qa_rules`
(a `text[]` holding the gate's top rule ids and the live findings' rule ids
under one vocabulary). DDL: `python/sql/2026-09-19_qa_columns.sql`. Query:
`GET /gop/admin/qa` (`python/gop_routes.py`), which `/admin/qa` renders.
