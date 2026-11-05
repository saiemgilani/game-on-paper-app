/**
 * The Situations section's pure steps (BB-G25): the situations the control offers (the league's periods in the season's
 * regulation), the whitelisted ?situation= and the row labels. Nothing here aggregates: every number is the producer's
 * row (rule B6).
 */
import { regulationFor } from '../basketball/config';
import type { PlayerSituationalRow, SituationalReads, SituationalRow } from '../resources/situational';
import type { BasketballLeague } from './league';
import type { UnitLabel } from './lineups';

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

/** The control's options: All, Clutch, the season's periods and overtime, Leading, Trailing, Garbage time out, vs top N. */
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
    ];
}

/** ?situation=: one of the options' keys; anything else is All. */
export function parseSituation(v: string | null, options: Situation[]): Situation {
    return options.find((s) => s.key === v) ?? options[0];
}

export interface SituationsTab {
    situation: Situation;
    options: Situation[];
    /** null when a read failed (the section says so) */
    reads: SituationalReads | null;
    /** one per player row */
    playerNames: string[];
    /** one per unit row */
    unitLabels: UnitLabel[];
}

/** The team table's rows: the situation's, then All for reference (the one row when the situation is All). */
export function teamRows(rows: SituationalRow[], s: Situation): SituationalRow[] {
    const find = (family: string, split: string) => rows.find((r) => r.family === family && r.split === split);
    const all = find('all', 'all');
    if (!all) return [];
    const own = s.key === 'all' ? undefined : find(s.family, s.split);
    return own ? [own, all] : [all];
}

/** Each player row's name; an id with no name reads as `#<id>`. */
export function nameRows(rows: PlayerSituationalRow[], names: Map<string, string>): string[] {
    return rows.map((r) => names.get(String(r.player_id)) ?? `#${r.player_id}`);
}
