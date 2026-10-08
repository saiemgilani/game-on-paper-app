import type { SDVTeamTendency } from '../resources/sdv';
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
}

export const TEAM_SPLIT_ROWS: TeamSplitRowDef[] = [
    { key: '', label: 'Overall' },
    { key: 'd1', label: '1st down' },
    { key: 'd2', label: '2nd down' },
    { key: 'd3_short', label: '3rd & short', title: '3rd down, 1-3 yards to go' },
    { key: 'd3_medium', label: '3rd & medium', title: '3rd down, 4-6 yards to go' },
    { key: 'd3_long', label: '3rd & long', title: '3rd down, 7 or more yards to go' },
    { key: 'd4', label: '4th down' },
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

const METRICS = ['plays', 'pass_rate', 'epa_per_play', 'success_rate'] as const;

export type TeamSplitSide = 'off' | 'def';

export interface TeamSplitRow {
    key: string;
    label: string;
    title?: string;
    plays: number | null;
    pass_rate: number | null;
    epa_per_play: number | null;
    success_rate: number | null;
}

const column = (metric: string, split: string, side: TeamSplitSide) =>
    `${side === 'def' ? 'def_' : ''}${metric}${split ? `_${split}` : ''}`;

/**
 * The `select` list: both sides of every split this league carries. An unknown
 * column is a 400 upstream, which is why `vs_ranked` stays out of the NFL list.
 */
export function teamSplitColumns(league: League): string[] {
    return TEAM_SPLIT_ROWS
        .filter((r) => !r.leagues || r.leagues.includes(league))
        .flatMap((r) => (['off', 'def'] as const).flatMap((side) =>
            METRICS.map((m) => column(m, side === 'def' ? (r.defKey ?? r.key) : r.key, side))));
}

/**
 * The table's rows for one side. A split whose plays column is absent (not
 * selected for this league, or not produced for this season) has no row; a
 * split with zero plays keeps its row with null rates, which print as dashes.
 */
export function teamSplitRows(row: SDVTeamTendency | undefined, side: TeamSplitSide): TeamSplitRow[] {
    if (!row) return [];
    return TEAM_SPLIT_ROWS.flatMap((r) => {
        const split = side === 'def' ? (r.defKey ?? r.key) : r.key;
        const plays = numberOrNull(row[column('plays', split, side)]);
        if (plays === null) return [];
        const rate = (m: string) => (plays === 0 ? null : numberOrNull(row[column(m, split, side)]));
        return [{
            key: r.key || 'overall', label: r.label, title: r.title, plays,
            pass_rate: rate('pass_rate'), epa_per_play: rate('epa_per_play'), success_rate: rate('success_rate'),
        }];
    });
}
