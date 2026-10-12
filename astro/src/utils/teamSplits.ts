import type { SDVTeamTendency } from '../resources/sdv';
import { COACH_MIN_PLAYS, splitByMinPlays } from './coaches';
import type { League } from './league';
import { numberOrNull } from './misc';

/**
 * The season team page's Situational Splits table: one `team_tendencies` row
 * (season x team) read as Plays / Pass Rate / EPA/Play / Success Rate per split,
 * for the offense or the defense. Column names are `{metric}_{split}`, the
 * overall row the bare `{metric}`, and the defense side the `def_` twins.
 *
 * The producer reads a play-level split from the OFFENSE's side, so on defense
 * the score and field splits swap to stay in this team's perspective: the team
 * is Leading when the offense it faces is trailing, and in its Own half when that
 * offense is in its opponent's half. Downs, red zone, one score and the game
 * context rows (home/away/...) read the same-named `def_` column: the context
 * columns are already the defending team's games.
 *
 * Early and late downs are the game page's definitions (sdv-py `early_down` /
 * `late_down`: 1st-2nd and 3rd-4th down). The table has an `early_down` split;
 * late downs have no column, so that row sums the 3rd- and 4th-down COUNTS and
 * re-rates them (the table's contract: counts sum, rates are recomputed).
 *
 * EPA/Play and Success Rate carry a national rank: this team against every team
 * in the same season's table that clears the coach boards' season minimum
 * (`COACH_MIN_PLAYS.season` plays), so the population is the FBS for college
 * (2025: 138 rows qualify; every non-qualifier is an FCS team with 3 or fewer
 * FBS games). The producer publishes no `_rank` for these columns, so the page
 * ranks the full table it reads; Plays and Pass Rate are counts and a style,
 * not quality, and carry none (as the coach boards' style columns).
 */
export interface TeamSplitRowDef {
    /** the column suffix; `''` is the overall row */
    key: string;
    label: string;
    title?: string;
    /** only these leagues carry the columns; absent means every league */
    leagues?: League[];
    /** the split the defense side reads, when it is not `key` */
    defKey?: string;
    /** a down under its Early/Late downs row, printed indented */
    sub?: boolean;
    /** no column of its own: the sum of these splits' counts, re-rated */
    parts?: string[];
}

export const TEAM_SPLIT_ROWS: TeamSplitRowDef[] = [
    { key: '', label: 'Overall' },
    { key: 'early_down', label: 'Early downs', title: '1st and 2nd down' },
    { key: 'd1', label: '1st down', sub: true },
    { key: 'd2', label: '2nd down', sub: true },
    { key: 'late_down', label: 'Late downs', title: '3rd and 4th down', parts: ['d3', 'd4'] },
    { key: 'd3_short', label: '3rd & short', title: '3rd down, 1-3 yards to go', sub: true },
    { key: 'd3_medium', label: '3rd & medium', title: '3rd down, 4-6 yards to go', sub: true },
    { key: 'd3_long', label: '3rd & long', title: '3rd down, 7 or more yards to go', sub: true },
    { key: 'd4', label: '4th down', sub: true },
    { key: 'red_zone', label: 'Red zone' },
    { key: 'own_half', label: 'Own half', defKey: 'opp_half' },
    { key: 'opp_half', label: 'Opponent half', defKey: 'own_half' },
    { key: 'leading', label: 'Leading', defKey: 'trailing' },
    { key: 'tied', label: 'Tied' },
    { key: 'trailing', label: 'Trailing', defKey: 'leading' },
    { key: 'one_score', label: 'One score', title: 'Score within 8 points at the snap' },
    { key: 'home', label: 'Home' },
    { key: 'away', label: 'Away' },
    { key: 'neutral_site', label: 'Neutral site' },
    { key: 'vs_ranked', label: 'vs Ranked', title: 'Opponent ranked in the top 25 at kickoff', leagues: ['cfb'] },
];

/** a team-season below this many plays is shown but not ranked, nor ranked against */
export const TEAM_SPLIT_MIN_PLAYS = COACH_MIN_PLAYS.season;

const METRICS = ['plays', 'pass_rate', 'epa_per_play', 'success_rate'] as const;
/** a summed row's counts: plays, then the numerators of the three rates */
const COUNTS = ['plays', 'passes', 'epa', 'successes'] as const;

export type TeamSplitSide = 'off' | 'def';

export interface TeamSplitRow {
    key: string;
    label: string;
    title?: string;
    sub?: boolean;
    plays: number | null;
    pass_rate: number | null;
    epa_per_play: number | null;
    success_rate: number | null;
    /** 1 is best (highest on offense, lowest allowed on defense); null when unranked */
    epa_rank: number | null;
    success_rank: number | null;
    /** how many qualifying teams have a value for this split: the rank's scale */
    ranked: number;
}

const column = (metric: string, split: string, side: TeamSplitSide) =>
    `${side === 'def' ? 'def_' : ''}${metric}${split ? `_${split}` : ''}`;

const visible = (league: League) => TEAM_SPLIT_ROWS.filter((r) => !r.leagues || r.leagues.includes(league));

/**
 * The `select` list: both sides of every split this league carries (a summed
 * row's part counts instead of its rates). An unknown column is a 400 upstream,
 * which is why `vs_ranked` stays out of the NFL list.
 */
export function teamSplitColumns(league: League): string[] {
    return visible(league).flatMap((r) => (['off', 'def'] as const).flatMap((side) =>
        r.parts
            ? r.parts.flatMap((p) => COUNTS.map((m) => column(m, p, side)))
            : METRICS.map((m) => column(m, side === 'def' ? (r.defKey ?? r.key) : r.key, side))));
}

type Values = Pick<TeamSplitRow, 'plays' | 'pass_rate' | 'epa_per_play' | 'success_rate'>;

/** One split's four values off one row, or null when its plays column is absent. */
function values(row: SDVTeamTendency, r: TeamSplitRowDef, side: TeamSplitSide): Values | null {
    if (r.parts) {
        const sums = COUNTS.map((m) => r.parts!.reduce<number | null>((acc, p) => {
            const v = numberOrNull(row[column(m, p, side)]);
            return acc === null || v === null ? null : acc + v;
        }, 0));
        const [plays, passes, epa, successes] = sums;
        if (plays === null) return null;
        const rate = (n: number | null) => (plays === 0 || n === null ? null : n / plays);
        return { plays, pass_rate: rate(passes), epa_per_play: rate(epa), success_rate: rate(successes) };
    }
    const split = side === 'def' ? (r.defKey ?? r.key) : r.key;
    const plays = numberOrNull(row[column('plays', split, side)]);
    if (plays === null) return null;
    const rate = (m: string) => (plays === 0 ? null : numberOrNull(row[column(m, split, side)]));
    return { plays, pass_rate: rate('pass_rate'), epa_per_play: rate('epa_per_play'), success_rate: rate('success_rate') };
}

/** Competition rank ("1224") of `value` among `field`; null when either is missing. */
function rankIn(value: number | null, field: (number | null)[], side: TeamSplitSide): number | null {
    if (value === null) return null;
    const better = (v: number) => (side === 'def' ? v < value : v > value);
    return 1 + field.filter((v): v is number => v !== null && better(v)).length;
}

/**
 * The table's rows for one side. A split whose plays column is absent (not
 * selected for this league, or not produced for this season) has no row; a
 * split with zero plays keeps its row with null rates, which print as dashes.
 * `season` is every team's row for the same season, the rank's population; the
 * team is ranked only when it qualifies itself.
 */
export function teamSplitRows(row: SDVTeamTendency | undefined, side: TeamSplitSide, season: SDVTeamTendency[] = []): TeamSplitRow[] {
    if (!row) return [];
    const { qualified } = splitByMinPlays(season, TEAM_SPLIT_MIN_PLAYS);
    const ranks = qualified.some((t) => String(t.pos_team_id) === String(row.pos_team_id));
    return TEAM_SPLIT_ROWS.flatMap((r) => {
        const v = values(row, r, side);
        if (v === null) return [];
        const field = ranks ? qualified.map((t) => values(t, r, side)) : [];
        const epa = field.map((f) => f?.epa_per_play ?? null);
        const success = field.map((f) => f?.success_rate ?? null);
        return [{
            key: r.key || 'overall', label: r.label, title: r.title, sub: r.sub, ...v,
            epa_rank: ranks ? rankIn(v.epa_per_play, epa, side) : null,
            success_rank: ranks ? rankIn(v.success_rate, success, side) : null,
            ranked: epa.filter((x) => x !== null).length,
        }];
    });
}
