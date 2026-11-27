# Air yards and pass direction: gates and coverage (2026-11-26)

The question: which air-yards views (offense, and defense: air yards allowed and
aDOT allowed; direction: left / middle / right, short / deep) does the site
compute but hide behind a preview flag, and is ESPN's coverage good enough to
show them?

**Short answer:** there is no gate to remove. Every air-yards view the site has
is already public, on the game page. The team and player pages have no
air-yards or direction views, hidden or otherwise, and nothing anywhere
computes the defensive side. 2026 coverage is good (96.4% of FBS pass
attempts). 2025 has high coverage (94.5%) only from Week 9 on. So this note changes no code.
A defensive or directional view on the team or player pages would be a new
feature, and per `docs/design-conventions.md` §9 it has to ship behind its own
`'preview'` flag.

**Since this note was written (same day):** #515 built that view (the
team-season page's Passing Direction panel, offense and defense, behind
`'team-pass-direction'`), and #517 corrected the game page's depth labels,
which said 0-12 / 12+ air yards. ESPN's "deep" is 20+ air yards in college and
16+ in the NFL; §2 *What short and deep mean* has the full-season evidence.
The inventory below is as of `main` after #517.

## 1. Inventory

Searched `astro/src`, `astro/public/assets/css`, `python/` and `docs/` for
`air_yards`, `aDOT`, `AirYds`, `CompAirYds`, `pass_direction`, `pass_depth`,
`yards_after_catch`, `deep`, left/middle/right, `display:none` and `hidden` on
those blocks, and commented-out template blocks. Also checked every `FLAGS`
entry in `astro/src/utils/features.ts`, the history (`git log -S air_yards`,
PRs #178, #180, #267, #274) and the unmerged remote branches.

| Where | What it shows | Gate | Notes |
|---|---|---|---|
| `astro/src/components/game/metrics/PassingChart.astro:86` | Target Matrix: deep / short (ESPN's split: 20 air yards in college, 16 in the NFL, rows labelled since #517) × left / middle / right, with total EPA, completions / attempts, yards, and aDOT and YAC per cell (#178; TDs are summed but not rendered) | None. `hidden={countableAttempts == 0}` hides it only when no pass in the game has both depth and direction | The caption (line 124) says sacks and passes without depth and direction are left out |
| `astro/src/components/game/metrics/PlayerBoxScore.astro:71` | `airLine`: "N air yds / N YAC, N aDOT" on passer and receiver stat lines (#180), called at `:124` and `:172` | None. Prints nothing when `aDOT` is null (no catch spot in ESPN's text) | Values come from the processor's box (`AirYds`, `aDOT`, `CompAirYds`, `YAC`, `AirYdsPct`, `astro/src/resources/python.ts:895`, `:916`) |
| `astro/src/components/game/metrics/TeamPlayerStats.astro:65` | Mounts `PassingChart` for each team | None. `'player-quarter-filter'` (preview) only adds the quarter/half select around it | Mounted from `GamePage.astro:349`, `:354` in the collapsed (`show={false}`) team panels, which is not a gate |
| Team-season page (`/year/<season>/team/<id>`): Passing Direction, `astro/src/components/routes/SeasonTeamRoute.astro:154` (#515, after this note) | Offense and Defense pass attempts by depth and direction: Comp/Att, share, EPA/play, success rate, aDOT, and how many attempts each side charts | `'team-pass-direction'` (`astro/src/utils/features.ts:348`), `'preview'`. College only, 2025 on | New UI, so it ships behind the flag; promotion to `'on'` is its own reviewed change |
| Team page (`pages/team/[id].astro`), player page (`pages/players/[id].astro`), Pro team/player pages | Nothing on air yards or direction | n/a | No component reads these fields |
| Defense (air yards allowed, aDOT allowed) | The Passing Direction panel's Defense side (#515): the opponents' attempts against the team | `'team-pass-direction'` | Nowhere else: the game page's box rows are per passer and per receiver, offense only |

On the deployed site, `/game/401862833` (2026, Week 12) renders the Target
Matrix and the aDOT tails. `/game/401754532` (2025, Week 3) renders the matrix
`hidden`, because none of its passes carry direction, not because of a flag.

The fields come from sportsdataverse-py's ESPN play-by-play processor:
`pass_depth` and `pass_direction` from a `\s(short|deep)\s` /
`\s(left|middle|right)\s` match on the play text (sportsdataverse/sportsdataverse-py#1355
anchors both on the "pass [complete|incomplete] short|deep left|middle|right"
phrase; §2 *What short and deep mean* says why). `air_yards` is the line of
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

### What short and deep mean

`pass_depth` is ESPN's own word, not a cut the processor makes, so its meaning
was measured: the label read from the text with sportsdataverse-py's match,
against an air-yards figure from elsewhere, over full seasons.

| League | Seasons, source | Air yards at the boundary | Crossings |
|---|---|---|---|
| College | every 2025 and 2026 pass attempt, `espn_cfb_pbp` (air yards from the text's catch / throw spot) | at 19: 974 short, 4 deep; at 20: 1 short, 942 deep | 15 of 71,430 charted attempts, each a bad spot in the text (a "caught at Miami00" touchdown, a play written twice) |
| NFL | every 2006-2025 pass attempt, the sdv ESPN NFL release (air yards the league's own) | at 15: 8,359 short, 29 deep; at 16: 2 short, 7,080 deep | 136 of 366,286, each a throw into or at the end zone (124) or a reversed or nullified play |

So deep is **20+ air yards in college and 16+ in the NFL** (the league's
15-yard short pass), short is anything under, and short includes throws behind
the line (about 20% of college short attempts). The game page labelled the rows
0-12 / 12+ until #517.

The old `\s(short|deep)\s` / `\s(left|middle|right)\s` match also read those
words anywhere in the text. On the NFL release that gave 16,645 scrambles a
pass depth or direction ("scrambles right end") and lost the direction of 5,437
incompletions whose text ends on it ("pass incomplete short right."), so the
charted completion rate ran 63.9% against 62.7% for all attempts. Anchored on
the pass phrase (sportsdataverse/sportsdataverse-py#1355), the NFL charts 99.1% of attempts at a
63.0% completion rate. College changes on 6 of 114,319 pass rows, each a fix.

When the text carries the phrase, measured the same way:

- **College passes:** 0-3.3% of attempts through 2025 Week 8, 89.8% in Week 9,
  90-96% after; 94-97% every week of 2026. Before 2025, 43 charted attempts in
  total (2023: 42 across 40 games, 2024: one; every season 2004-2022: none).
- **College rushes:** the same 2025 step (93.0% of rushes in Week 9), plus some
  older games: 463 in 2004 and 52-104 a season in 2007-2013.
- **NFL:** 93-99% of pass attempts and about 96% of rushes in every season
  2006-2025.

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
  all from Week 9 (late October) on.
- **The game page**: already handles thin games. The matrix hides when a game
  has no charted passes, the stat-line tail prints nothing when `aDOT` is null,
  and the caption says uncharted passes are left out. One small copy fix is
  possible: the caption says the data "started appearing in 2025", and
  "late in the 2025 season (Week 9)" would be more precise.

Each of these is new UI, so it ships behind a `'preview'` flag, and promoting it
to `'on'` is a separate reviewed one-liner.

What happened to each, later the same day:

- **Team page splits, offense and defense:** built in #515 as the Passing
  Direction panel, behind `'team-pass-direction'`. Each side shows how many of
  its attempts it charts, and a season before 2025 reads nothing.
- **2025:** the panel says how much of the season it charts and why ("ESPN's
  play text carries depth and direction from 2025 Week 9 on").
- **The game page:** #517 put ESPN's split in the row labels (20 / 16 air
  yards), dated the pass caption to 2025 Week 9 for college games, and dropped
  the date from the NFL caption and from the rush matrix, whose text predates
  2025 in both leagues.
