# Percentile Visuals on Team Page

Hi there, I wanted to propose a new feature for the team pages. Taking
inspiration from Cleaning The Glass I think showing percentiles on the
individual player stats would be helpful. This is a mockup image with
some fake data:

![Mockup of player-stat percentiles on the Georgia Tech team page](img/test_screenshot.png)

I am a Data Scientist by trade so I don't know exactly how best to implement
this feature. I am happy to help Codex drive and implement this service but I
wanted to get your approval before moving forward since this is your project.
I have reached out on twitter to get an API token but never got a response. I'm
hoping that this PR can serve as a place for us to discuss the implementation
details and see if y'all are comfortable with me moving forward.

This is a proposal outline generated from Codex on what changes are needed,
I hope its helpful:

## Percentile Stats Plan

This is a modest frontend/data-pipeline change: no new service, database, or
public API.

- Add a scheduled GitHub Action, runnable manually and daily during the season,
  that:
  - fetches full-season passing, rushing, and receiving summaries from
    SportsDataverse;
  - applies the existing leaderboard qualification thresholds;
  - calculates percentiles for every displayed stat, using completion percentage
    for the passing Comp/Att column;
  - writes compact `player ID → stat → percentile` JSON snapshots to the
    existing `SDV_API_CACHE` Cloudflare KV namespace, keyed by season and
    category; and
  - preserves the previous snapshot when an upstream request is incomplete or
    invalid.
- Add a one-time, manually run backfill for historical seasons; afterward, only
  refresh the active season.
- Update the team-page data helper to read the precomputed KV snapshot and pass
  the appropriate percentile map into the passing, rushing, and receiving
  tables.
- Update those three table components to show the current raw value followed by
  a muted percentage, with `(percentile)` in each stat header. Keep current
  formatting, ordering, and responsive horizontal scrolling unchanged.
- Add a small typed percentile interface and pure calculation helper; verify
  tied values, missing values, qualification boundaries, and the rendered
  Georgia Tech page. Run the existing Astro build in CI.

The existing deployment workflow already has `SDV_AUTH_TOKEN`,
`CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID`, and the Worker already
binds `SDV_API_CACHE`; the new workflow can reuse them. No new secrets or
Cloudflare resources should be required.

---

## Details settled in review

The outline above leaves several things unspecified that would each produce
wrong numbers on the page. Working through the review findings on this PR, and
checking them against the current code, here is what the implementation needs to
commit to. Each was verified against `main` rather than assumed.

### 1. The ranking contract

A raw ascending percentile is wrong for three of the displayed columns. These
are the stats the team tables actually render today:

| Table | Columns | Direction |
|---|---|---|
| Passing | Comp/Att, Yds, TD, **INT**, **Sacks**, Yds/dropback, EPA/dropback, EPA, SR% | higher better except **INT**, **Sacks** |
| Rushing | Carries, Yds, TD, **Fum**, Yds/rush, EPA/rush, EPA, SR% | higher better except **Fum** |
| Receiving | Catches, Targets, Catch Rate, Yds, TD, **Fum**, Yds/play, EPA/play, EPA, SR% | higher better except **Fum** |

So the contract is one explicit direction per column, not a global rule:

- **Direction** — a `higher_is_better: boolean` per stat, stored with the
  snapshot rather than inferred from the column name. (Inferring from the name
  is how a "defensive EPA" column ends up ranked backwards.)
- **Scale** — integer 0–100, where 100 is best *after* direction is applied, so
  the page never has to know which way a stat runs.
- **Ties** — equal values receive equal percentiles. Specify which convention:
  midrank ("average") is the usual choice for display, and unlike
  `strictly_less` it does not give the worst player a non-zero percentile.
- **Comp/Att** — percentile on completion percentage, as the outline says, but
  attempts must clear the qualification bar first or a 1-for-1 passer scores in
  the 99th percentile.
- **Missing / zero-attempt** — render nothing, not a `0`. A player with no
  targets has no receiving percentile; a zero is a claim about him that the data
  does not support.

**One thing worth deciding explicitly:** volume stats (Yds, TD, Carries,
Targets, total EPA) and rate stats (EPA/play, SR%, Yds/rush, Catch Rate) mean
different things as percentiles. A volume percentile is largely a workload
percentile. That may be exactly what you want next to a counting stat — but it
should be a decision, not a side effect.

### 2. The qualification population does not match what the page displays

The team page currently fetches a fixed top-N per category, sorted by plays,
with **no qualification threshold** applied
(`src/pages/year/[year]/team/[id].astro`):

```ts
retrievePlayerSummaries(year, PASSING,   id, "plays", false, 10,  year)
retrievePlayerSummaries(year, RUSHING,   id, "plays", false, 20,  year)
retrievePlayerSummaries(year, RECEIVING, id, "plays", false, 25,  year)
```

So a team's 20th rusher or 25th receiver is very likely below any national
qualification bar. If percentiles are computed only over qualified players,
those rows render with a blank percentile — the feature silently disappears
exactly where the tables are longest.

Two coherent options; the proposal should pick one:

1. **Qualify the display too** — apply the same threshold before rendering, so
   every displayed row has a percentile. Changes what the page shows today.
2. **Percentile everyone, rank against the qualified population** — keep the
   top-N display, and compute each displayed player's percentile *against* the
   qualified distribution even when he is not himself qualified. Nothing
   disappears, and the denominator stays meaningful.

Option 2 preserves current behaviour and is probably the right default, but it
needs saying out loud, because it means a percentile can be reported for a
player who would not appear on a leaderboard.

### 3. Fetching the full population needs pagination

`retrievePlayerSummaries` takes `limit: number = 150` and does no pagination
(`src/resources/sdv.ts`). The leaderboard passes `150` explicitly. That is fine
for a leaderboard page; it is not a national population. With ~130 FBS teams,
qualified receivers alone run well past 150, so percentiles computed from a
single call would be ranked against the top 150 players rather than the field —
which inflates every percentile toward zero.

The pipeline needs either pagination through the full result set or a dedicated
full-season fetcher, and it should **assert the returned count** before using
it, rather than trusting that one page was the whole thing.

### 4. An empty response is not the same as a failure

This is the one most likely to corrupt data silently. `requestSDV` converts
every upstream failure into an empty success (`src/resources/sdv.ts`):

```ts
} catch (e) {
    console.error(`ERROR while loading data from SDV API endpoint (${endpointURL}): ${e}`)
    return {
        "data": []
    }
}
```

An HTTP 500, a JSON parse error and a genuinely empty season are indistinguishable
to the caller. A pipeline that writes a snapshot whenever the fetch "succeeds"
would therefore overwrite a good snapshot with empty percentiles the first time
the API has a bad day — and the page would render blank percentiles for a season
that was fine yesterday.

The fetcher used by this job must return explicit success metadata (HTTP status,
record count, validation result), and the job must write the new snapshot **only**
after that metadata checks out. The outline's "preserves the previous snapshot
when an upstream request is incomplete or invalid" is right; this is the
mechanism it needs in order to be true.

### 5. Snapshot keys and runtime validation

`SDV_API_CACHE` is a shared namespace, and `requestSDV` already writes into it
under hashed endpoint keys. Percentile snapshots should:

- use a **versioned, namespaced key** — `percentiles:v1:<season>:<category>` —
  so they cannot collide with cached API responses and so an incompatible
  schema change is a new prefix rather than a silent misread; and
- carry **metadata** alongside the map: schema version, source season, the
  qualification threshold used, population size, and the time it was built.

A TypeScript interface is a compile-time assertion about code, not a runtime
assertion about JSON that arrived from KV. The snapshot needs an actual
validator on **read** as well as on write: reject unknown shapes, missing keys,
non-finite numbers, and percentiles outside 0–100, and fall back to rendering
without percentiles rather than rendering wrong ones.

### Note on one review comment

A review comment reports that `img/test_screenshot.png` is missing and the
mockup renders broken. That one is not right — the image is committed on this
branch (33 KB) and the relative path from the repository root resolves. No
change needed.
