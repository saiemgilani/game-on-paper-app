# Air yards and pass direction: gates and coverage (2026-11-26)

The question: which air-yards views (offense, and defense: air yards allowed and
aDOT allowed; direction: left / middle / right, short / deep) does the site
compute but hide behind a preview flag, and is ESPN's coverage good enough to
show them?

**Short answer:** there is no gate to remove. Every air-yards view the site has
is already public, on the game page. The team and player pages have no
air-yards or direction views, hidden or otherwise, and nothing anywhere
computes the defensive side. 2026 coverage is good (96.4% of FBS pass
attempts). 2025 is complete only from Week 9 on. So this note changes no code.
A defensive or directional view on the team or player pages would be a new
feature, and per `docs/design-conventions.md` §9 it has to ship behind its own
`'preview'` flag.

## 1. Inventory

Searched `astro/src`, `astro/public/assets/css`, `python/` and `docs/` for
`air_yards`, `aDOT`, `AirYds`, `CompAirYds`, `pass_direction`, `pass_depth`,
`yards_after_catch`, `deep`, left/middle/right, `display:none` and `hidden` on
those blocks, and commented-out template blocks. Also checked every `FLAGS`
entry in `astro/src/utils/features.ts`, the history (`git log -S air_yards`,
PRs #178, #180, #267, #274) and the unmerged remote branches.

| Where | What it shows | Gate | Notes |
|---|---|---|---|
| `astro/src/components/game/metrics/PassingChart.astro:76` | Target Matrix: deep (12+) / short (0-12) × left / middle / right, with attempts, completions, yards, EPA, TD, aDOT and YAC per cell (#178) | None. `hidden={countableAttempts == 0}` hides it only when no pass in the game has both depth and direction | The caption (line 114) says sacks and passes without depth and direction are left out |
| `astro/src/components/game/metrics/PlayerBoxScore.astro:71` | `airLine`: "N air yds / N YAC, N aDOT" on passer and receiver stat lines (#180) | None. Prints nothing when `aDOT` is null (no catch spot in ESPN's text) | Values come from the processor's box (`AirYds`, `aDOT`, `CompAirYds`, `YAC`, `AirYdsPct`, `astro/src/resources/python.ts:895`, `:916`) |
| `astro/src/components/game/metrics/TeamPlayerStats.astro:65` | Mounts `PassingChart` for each team | None. `'player-quarter-filter'` (preview) only adds the quarter/half select around it | Mounted from `GamePage.astro:343`, `:348` in the collapsed (`show={false}`) team panels, which is not a gate |
| Team page (`pages/team/[id].astro`), player page (`pages/players/[id].astro`), Pro team/player pages | Nothing on air yards or direction | n/a | No component reads these fields |
| Defense (air yards allowed, aDOT allowed) | Not computed anywhere: no component and no processor field | n/a | The box rows are per passer and per receiver, offense only |

On the deployed site, `/game/401862833` (2026, Week 12) renders the Target
Matrix and the aDOT tails. `/game/401754532` (2025, Week 3) renders the matrix
`hidden`, because none of its passes carry direction, not because of a flag.

The fields come from sportsdataverse-py's ESPN play-by-play processor:
`pass_depth` and `pass_direction` from a `\s(short|deep)\s` /
`\s(left|middle|right)\s` match on the play text. `air_yards` is the line of
scrimmage minus the spot in the text ("caught at X" on completions, "thrown to
X" on incompletions), and `yards_after_catch = statYardage - air_yards` on completions.

## 2. Coverage

Source: the `espn_cfb_pbp` release of sportsdataverse-data (`play_by_play_2025`
and `play_by_play_2026` parquet, both republished 2026-11-25), the same data the
site's processor produces. FBS membership and conference come from the
`espn_cfb_teams` release (`is_fbs`, `conference_short_name`), joined on
`pos_team_id` (offense) or `def_pos_team_id` (defense). Pass attempts are
`pass_attempt == True` with sacks removed. 2026 is regular season, Weeks 1-12.

### Headline

| Season | FBS pass attempts | air yards | direction | depth | depth + direction (a Target Matrix cell) |
|---|---:|---:|---:|---:|---:|
| 2026, Weeks 1-12 | 45,559 | **96.4%** | 96.4% | 96.6% | 96.4% |
| 2025, full season | 53,473 | 43.6% | 43.6% | 43.7% | 43.6% |
| 2025, Weeks 9-16 + postseason | 24,545 | 94.5% | 94.4% | 94.5% | 94.4% |

In 2026, 98.4% of completions carry air yards and 93.0% of incompletions do.
FBS-vs-FBS games alone: 96.4%.

### 2025 is a step, not a slope

ESPN's play text gained the "short / deep left / middle / right ... caught at /
thrown to" wording during 2025. FBS offense, by week:

| Week | 1-2 | 3 | 4-7 | 8 | 9 | 10 | 11-14 | 15-16 | Postseason |
|---|---|---|---|---|---|---|---|---|---|
| air yards | 0.0% | 0.4% | 0.0% | 3.4% | 89.9% | 95.0% | 96.1-96.4% | 91.7-96.9% | 90.2% |

So a 2025 team or player season total that includes September and October is
mostly missing these fields. For 2025, any season view would need either a
Week 9+ window or a "charted attempts" count beside every number.

### By conference (2026)

Even across conferences. Offense ranges from 95.7% (ACC) to 97.2% (FBS
Independents). Defense, by the defending team's conference, ranges from 95.6%
(ACC, American) to 97.0% (Big 12). In 2025 the spread by conference (36-51%)
only reflects how many games each league played after Week 9.

### By game (2026)

1,517 team-games (FBS offense):

- median 97.1% of a team's pass attempts carry air yards; 10th percentile
  91.4%; 1st percentile 82.9%
- 5.8% of team-games fall below 90%; 0.3% fall below 50%
- 4 team-games have none, in two games (`401856634`, `401858212`), whose ESPN
  text uses the older "pass complete to X for N yds" wording with no spot or
  direction

### What the remaining ~3.6% is

Plays whose text has no direction or spot: scoring passes written as
"X 15 Yd pass from Y (kick)", interceptions ("pass intercepted by X at Y"),
spikes, two-point tries, and the older wording in a few games. That is a
text-extraction limit in sportsdataverse-py, not something the site can fill in.

## 3. Decision

No code change in this PR. Coverage clears the 90% bar for 2026, but there is
no gate to lift, and the views the question names (team and player season
direction splits, and anything defensive) don't exist yet.

If those views get built, the numbers above point to:

- **Offense and defense direction / depth splits on the team page** (2026): fine
  to build. Each split cell should show its charted-attempt count, the same way
  the Target Matrix sums only the attempts that carry depth and direction.
- **Air yards allowed / aDOT allowed**: the same plays grouped by
  `def_pos_team`, with the same coverage (95.6-97.0% by conference).
- **2025 season views**: restrict them to Week 9 on, or label them clearly as
  partial. A full-season 2025 aDOT would rest on less than half the attempts,
  all from November and later.
- **The game page**: already handles thin games. The matrix hides when a game
  has no charted passes, the stat-line tail prints nothing when `aDOT` is null,
  and the caption says uncharted passes are left out. One small copy fix is
  possible: the caption says the data "started appearing in 2025", and
  "late in the 2025 season (Week 9)" would be more precise.

Each of these is new UI, so it ships behind a `'preview'` flag, and promoting it
to `'on'` is a separate reviewed one-liner.
