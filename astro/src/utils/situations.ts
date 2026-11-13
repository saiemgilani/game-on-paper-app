/**
 * The Situations section's pure steps: the situations the control offers (the league's periods in the season's
 * regulation), the whitelisted ?situation= and the table's rows. Nothing here aggregates: every number is the producer's
 * row (rule B6).
 *
 * ponytail: TOP_N, Situation, situationsFor, parseSituation and the one-entity row pick are the team page's (GOP#416,
 * BB-G25, the same file), plus the transition and second-chance options the player page (BB-G55) adds; when the two
 * stacks meet, keep one copy (this one's options) and both pages' steps.
 */
import { regulationFor } from '../basketball/config';
import type { PlayerSplitRow, SituationalRow } from '../resources/situational';
import { PRO_LEAGUES, type BasketballLeague } from './league';

/**
 * The "vs top" opponents: the top N by adjusted net rating at the season's end, a hindsight ranking (sdv-db docs/api.md,
 * BB-D21: 10 NBA, 4 WNBA, 25 college).
 */
export const TOP_N: Record<BasketballLeague, number> = { nba: 10, wnba: 4, mbb: 25, wbb: 25 };

export interface Situation {
    /** the ?situation= value: the producer's split name */
    key: string;
    family: string;
    split: string;
    label: string;
    /** the select's optgroup */
    group?: 'By period';
    /** one line under the control */
    note: string;
}

const ORD = ['1st', '2nd', '3rd', '4th'];

/**
 * The control's options: All, Clutch, the season's periods and overtime, Leading, Trailing, Garbage time out, vs top N,
 * Transition and, for the pros, Second chance (college's play-by-play has no offensive-rebound flag, so no rows).
 */
export function situationsFor(league: BasketballLeague, season: number): Situation[] {
    const reg = regulationFor(league, season);
    const period = (key: string, label: string, where = `the ${label}`): Situation => ({ key, family: 'period', split: key, label, group: 'By period', note: `Possessions that start in ${where}.` });
    return [
        { key: 'all', family: 'all', split: 'all', label: 'All', note: 'Every possession.' },
        { key: 'clutch', family: 'clutch', split: 'clutch', label: 'Clutch', note: 'The last 5:00 of regulation or overtime with the score within 5.' },
        ...Array.from({ length: reg.periods }, (_, i) => period(`p${i + 1}`, `${ORD[i]} ${reg.kind}`)),
        period('ot', 'Overtime', 'overtime'),
        { key: 'leading', family: 'score', split: 'leading', label: 'Leading', note: 'Possessions that start with the team ahead.' },
        { key: 'trailing', family: 'score', split: 'trailing', label: 'Trailing', note: 'Possessions that start with the team behind.' },
        { key: 'not_garbage_time', family: 'garbage', split: 'not_garbage_time', label: 'Garbage time out', note: 'Every possession outside garbage time.' },
        { key: 'vs_top', family: 'opponent', split: 'vs_top', label: `vs top ${TOP_N[league]}`, note: `Games against the top ${TOP_N[league]} by adjusted net rating at the season's end.` },
        { key: 'transition', family: 'play_type', split: 'transition', label: 'Transition', note: "Transition possessions: the team's on offense, the opponent's on defense." },
        ...(PRO_LEAGUES.includes(league)
            ? [{ key: 'second_chance', family: 'chance', split: 'second_chance', label: 'Second chance', note: "Possessions with an offensive rebound: the team's on offense, the opponent's on defense." }]
            : []),
    ];
}

/** ?situation=: one of the options' keys; anything else is All. */
export function parseSituation(v: string | null, options: Situation[]): Situation {
    return options.find((s) => s.key === v) ?? options[0];
}

/** One entity's rows: the situation's, then All for reference (the one row when the situation is All); [] with no All row. */
export function situationRows<R extends SituationalRow>(rows: R[], s: Situation): R[] {
    const find = (family: string, split: string) => rows.find((r) => r.family === family && r.split === split);
    const all = find('all', 'all');
    if (!all) return [];
    const own = s.key === 'all' ? undefined : find(s.family, s.split);
    return own ? [own, all] : [all];
}

/**
 * A player's rows per team he played for, most possessions (in All) first; each team's as situationRows. `team` is, row for
 * row, that team's own producer row in the same split (review Q14: side by side, never blended); undefined with none.
 */
export function playerSituationRows(rows: PlayerSplitRow[], s: Situation, teamRows: PlayerSplitRow[] = []): { teamId: number; rows: PlayerSplitRow[]; team: (PlayerSplitRow | undefined)[] }[] {
    const teams = [...new Set(rows.map((r) => r.team_id))];
    const theirs = (teamId: number, r: PlayerSplitRow) => teamRows.find((t) => t.team_id === teamId && t.family === r.family && t.split === r.split);
    return teams
        .map((teamId) => situationRows(rows.filter((r) => r.team_id === teamId), s))
        .map((own, i) => ({ teamId: teams[i], rows: own, team: own.map((r) => theirs(teams[i], r)) }))
        .filter((t) => t.rows.length > 0)
        .sort((a, b) => (b.rows.at(-1)?.poss ?? 0) - (a.rows.at(-1)?.poss ?? 0));
}

export interface PlayerSituations {
    situation: Situation;
    options: Situation[];
    /** null when a read failed (the section says so) */
    rows: PlayerSplitRow[] | null;
    /** his teams' own rows (situational_team), beside his; null when that read failed (his rows still show) */
    team: PlayerSplitRow[] | null;
    /** team id -> tricode, for a player who played for more than one team */
    tricodes: Map<string, string>;
}
