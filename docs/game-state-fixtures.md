# Game-state fixtures

Live-game bugs are the ones we cannot reproduce. By the time anyone opens the
page the transient state is gone, so a report like "the drive chart looked
broken in the 3rd quarter" is unfalsifiable. These two scripts capture the
states as they happen and then assert against them.

## Capturing

    # follow every live game (FBS group 80 + FCS group 81) until each goes final
    python3 scripts/capture_game_states.py --auto --live-only --interval 45

    # a specific slate, also saving the rendered page for comparison
    python3 scripts/capture_game_states.py --games 401867874 401868962 --html

    # snapshot finished games as replay fixtures
    python3 scripts/capture_game_states.py --games 401752921 --once

A snapshot is written only when the ESPN payload actually changes, so a
4-hour game costs ~200 states instead of ~480 polls. Runs are resumable: the
manifest is replayed on start, and a game already marked final is skipped.

    fixtures/game-states/<game_id>/
        manifest.jsonl                     one line per state
        0007__20260827T233015Z__STATUS_IN_PROGRESS.json.gz
        0007__20260827T233015Z__STATUS_IN_PROGRESS.html.gz   (with --html)

Captures are gitignored: they are large and regenerable.

## Scanning

    python3 scripts/scan_game_states.py                  # captured fixtures
    python3 scripts/scan_game_states.py --sample 40      # live slate sample
    python3 scripts/scan_game_states.py --json out.json

Exit code is 1 if any `BREAKS` probe fires, so this can gate CI.

Every probe corresponds to a failure seen in `gop.error_log`, not a
hypothetical. Two of them are now regression tests for fixes already shipped
(`team_missing_color` → 96dc160, `duplicate_drive_ids` → b753c32).

## Two gotchas worth keeping

- `site.api.espn.com` returns **403 for any explicit `User-Agent`**, a
  browser-spoofed one included, but serves fine under urllib's default. Only
  our own origin gets an identifying UA.
- `groups=80,81` returns events with **no `competitions` key at all**. Query
  each group separately.

## What the first run found (22 live FCS games, 2026-08-27)

| probe | hit rate | meaning |
|---|---|---|
| `duplicate_drive_ids` | 18 of 22 games | ESPN repeats a drive id mid-game |
| `drive_missing_team` | 20 of 20 with drives | drive.team carries no colour |
| `team_missing_color` | 4 of 22 games | LIU, NWC, AND — 500s before 96dc160 |
| `state_regression` | 1 game | ESPN served an older payload than the one before |
| `score_decreased` | 1 game | 401868962: 17-0 → 7-0 between snapshots |

The last two are only visible across states, which is the point of capturing a
timeline rather than a single sample.
