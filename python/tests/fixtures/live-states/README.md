# Live-state fixtures

Three real slices of three real games' poll histories, for `tests/test_live_qa.py`.

Each `<game_id>.json.gz` holds `{game_id, why, source, states: [{seq, captured,
state, payload}]}`, where `payload` is in the shape `/process` returns after
`app._reshape_records` — `header.competitions[0].status` plus a `plays` list
carrying `id`, `text`, `type`, `period`, `clock`, `statYardage`, `scoringPlay`,
`modified`, `start` and `end`.

| game | seqs | why this one |
|---|---|---|
| 401866532 | 4-8 | ESPN served a payload 29 finished plays and a touchdown **older** than the one before it, then recovered |
| 401868962 | 1-4, 7-8 | the score ran backwards 17-0 → 7-0 → 0-0 across three polls, then halftime |
| 401856682 | 1-4, 23-25 | in progress → halftime → in progress → final, the healthy baseline |

## Provenance

Captured by `scripts/capture_game_states.py` into `fixtures/game-states/<id>/`
(gitignored, ~300MB, regenerable — see `docs/game-state-fixtures.md`), then
converted. No value is hand-written or edited; the conversion is mechanical and
is exactly this:

1. take `gamepackageJSON` from the captured state;
2. flatten `drives.previous` + `drives.current` into one play list, **first
   occurrence of a drive id wins** — the same dedupe `app._game_drives` applies,
   because a live ESPN summary repeats the current drive inside `previous`. This
   is why a state here carries fewer plays than the capture manifest's
   `n_plays` (seq 1 of 401856682: 78 against 83), and it is the count the
   `/process` payload carries too;
3. keep, per play, `id`, `text`, `type.{id,text,abbreviation}`,
   `period.number` → `period`, `clock.displayValue`, `statYardage`,
   `scoringPlay`, `modified`, and `start`/`end` `{down, distance,
   yardsToEndzone, yardLine}`, with ESPN's running `homeScore`/`awayScore`
   attached to `end` (ESPN's play-level score is the state after the play);
4. keep, per state, `header.competitions[0].status.{period, displayClock,
   type.{name,state,completed,detail}}` and each competitor's `homeAway`/`score`.

Re-deriving them from a fresh capture means repeating those four steps; the
rule counts in `tests/test_live_qa.py` are tied to this play set, so a different
flattening gives different numbers.

## What these fixtures cannot carry

They are ESPN payloads, so they have no win probabilities and no timeouts —
sdv-py derives both. `live.wp_continuity` and `live.timeouts_increased` are
therefore asserted by injecting those two fields into a real pair of polls,
which is also how every other rule is asserted: the pair must first pass clean,
then one mutation must make exactly that rule fire.
