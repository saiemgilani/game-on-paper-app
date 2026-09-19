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
trimmed to the fields `live_qa` reads. Regenerate by re-running that capture
and re-trimming; nothing here is hand-written, and no value was edited.

## What these fixtures cannot carry

They are ESPN payloads, so they have no win probabilities and no timeouts —
sdv-py derives both. `live.wp_continuity` and `live.timeouts_increased` are
therefore asserted by injecting those two fields into a real pair of polls,
which is also how every other rule is asserted: the pair must first pass clean,
then one mutation must make exactly that rule fire.
