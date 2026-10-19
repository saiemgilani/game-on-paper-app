# Paper Index oracle fixtures

`paper_index_oracle.json` (college) and `paper_index_oracle_nfl.json` (NFL) are
written by `python/tools/fit_paper_index.py` and never edited by hand. Each holds
the fitted weights, a `provenance` block, and 12 real holdout games with their
model inputs and the share the trainer computed at full weight precision. The
tests in `tests/test_paper_index.py` assert that `paper_index.py` reproduces
every share with its committed (4-decimal) weights, that the committed
constants equal the fixture's, that the provenance metrics still clear the
trainer's gates, and that the installed field-position curve matches the
fingerprint the weights were fitted against.

## Generator

From `python/`:

```bash
uv run python tools/fit_paper_index.py --league cfb
uv run python tools/fit_paper_index.py --league nfl --pbp-dir /path/to/espn_nfl/pbp
```

The trainer writes a fixture only when every gate passes (`GATES[<league>]`
plus the paired EPA-only rule `mean_delta + 2 * se <= 0`). Then paste the
printed `WEIGHTS[<league>]` and `LEAGUE_PTS_PER_OPP[<league>]` into
`paper_index.py`. `tools/paper_index_curve_sensitivity.py` produces the
`holdout_contamination.curve_sensitivity` numbers.

## Sources

| league | source | identity (in `provenance.seasons[<season>].input`) |
|---|---|---|
| cfb | `sportsdataverse-data` release tag `espn_cfb_pbp`, `play_by_play_<season>.parquet` | asset `bytes` + `updated_at` from the GitHub release API; all ten seasons' assets were updated 2026-09-07 (09:36–23:08 UTC) |
| nfl | `nfl-data` `out/espn_nfl/pbp/play_by_play_<season>.parquet`, the local build that is published as `espn_nfl_pbp` (rebuilt 2026-09-15 with sportsdataverse-py #495: `scoring_opp` keyed to `start.yardsToEndzone`, nflverse closing lines) | local file `bytes` + `sha256` |

`provenance.sportsdataverse` records the installed package version and git sha
(the processor whose EPA, success, explosiveness, havoc and drive fields the
inputs are built from), `provenance.fp_curve` the sha256 and five anchor points
of the bundled `<league>_field_position_ep.parquet`, and `provenance.fitted_at`
the UTC time of the run.

## Id dtypes

- `gameId` is a string, cast from the pbp's `game_id: Int64` (ESPN event id).
- Team ids in the trainer are cast to `Utf8` at the boundary (`pos_team_id`,
  `homeTeamId`, `awayTeamId` ship as `Int64`); the fixture stores only the
  aggregated inputs, keyed by side (`home` / `away`).

## Rows

Per-season accounting lives in `provenance.seasons`: `games_in_pbp` (distinct
`game_id` in the parquet), `after_join` (both offenses joined), `after_filters`
(ties dropped, both sides >= 20 scrimmage snaps, finite EPA), `games` (after the
ext-feature joins; the fitted rows), and for the NFL `non_franchise_dropped`.

| league | split | train games | holdout games | fixture games |
|---|---|---|---|---|
| cfb | train 2016-2023, holdout 2024-2025 | 6,637 | 1,894 | 12 (2024-2025) |
| nfl | train 2016-2021, holdout 2022-2025 | 1,615 | 1,137 | 12 (2022-2025) |

The NFL holdout was widened for power after the 2024-2025 holdout (n=570) failed
the paired EPA-only gate (mean -0.0141, se 0.0078); the trainer docstring
carries both runs.

## Known gaps

- Ties are dropped (the target is "home won"); e.g. NFL 2022 loses two games
  (401437637, 401437880).
- The cancelled 2022 BUF–CIN week 17 game is not in the pbp at all (only their
  week 2 meeting, 401438007, exists), so nothing had to drop it.
- NFL Pro Bowls (ESPN team ids 31/32) are dropped by `FRANCHISE_ALLOWLIST`:
  400878708 (2016), 400999088 (2017), 401038851 (2018), 401131046 (2019),
  401326637 (2021); the ids are listed per season in `non_franchise_dropped`.
- The NFL 2005 season parquet is an 18-game stub and is outside both splits.
- Holdout contamination: the bundled NFL field-position curve (2016-2025
  drives) and the NFL EP model (1999-2025), and the college EP model
  (2004-2025 per its card), all span the holdouts; see
  `provenance.holdout_contamination` and the curve sensitivity run
  (NFL: train-only curve gives holdout Brier 0.1177 vs 0.1174).

- `nba_summary_401585607.json.gz`: ESPN NBA summary (ORL vs TOR, 2024-03-17, 450 plays), the same capture sdv-py tests `espn_nba_pbp` on; no pickcenter line, so the prior is home-court only.
- `wnba_summary_250603003.json.gz`: ESPN WNBA summary (`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=250603003`,
  captured 2026-10-18, verbatim, gzip -9 -n): 2005-06-03, New York (ESPN 9) at Detroit (ESPN 3, abbreviation "TUL" in ESPN's data), 66-68,
  `format.regulation.periods` 2, one overtime (period 3), 459 plays, no pickcenter, not neutral. The pre-2006 halves game (spec §3.1, D14).
- `wnba_summary_401736325.json.gz`: same endpoint, `event=401736325`, captured 2026-10-18, verbatim: 2025-08-15, Seattle (14) vs Atlanta (20,
  home) at Rogers Arena, Vancouver, 80-78, `neutralSite` true, no pickcenter, four quarters, 391 plays. The neutral-site prior (D13).
- `nba_process_401585607.payload.json` regenerated 2026-10-18 on the sportsdataverse lock b4229f1c (sdv-py main, includes #900's
  `format` guard) through `test_nba_process_parity._body`: differs from 4298cacf only on sdv-py plan #1's 17 rebuilt running-score
  rows (`home_score` / `away_score` / `home_win_prob`) and `wp_delta` on them and the row after each (resolution R15; first at sequence 128, 26-24).
- `mbb_summary_401820775.json.gz`: ESPN men's college basketball summary
  (`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=401820775`, captured 2026-10-18, verbatim,
  gzip -9 -n): 2026-02-28, NC State (152) at Notre Dame (87), 90-96, two halves and one overtime (period 3), 466 plays, DraftKings line
  (NCSU -6.5), not neutral. The OT final.
- `mbb_summary_401744223.json.gz`: same endpoint, `event=401744223`, captured 2026-10-18: 2025-03-07, Old Dominion (295) vs Texas State
  (326, home) at Pensacola Bay Center (Sun Belt tournament), 64-61, `neutralSite` true, no pickcenter, 485 plays. The neutral prior (D13).
- `mbb_summary_401829457.json.gz`: same endpoint, `event=401829457`, captured 2026-10-18: 2025-11-23, Coastal Carolina (324) vs North Dakota
  (155, home) at Western Hall, 75-58 to CCU, neutral, no pickcenter, 538 plays; every ESPN play row carries the away team's score in
  `homeScore` (plan #1's neutral-site swap). The processor's repaired score.
