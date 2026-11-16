/**
 * The Play types and Defense panels' pure steps (BB-G19): his Synergy rows as two tables, and his matchup rows as the
 * defense lines. Every value, the percentile included, is the producer's (stats.nba.com's, via sdv-db): nothing is ranked
 * or recomputed here, only picked, ordered and labelled.
 */
import type { MatchupRollupRow, MatchupRow, SynergyRow } from '../resources/playerPlayTypes';
import { numberOrNull } from './misc';

/** stats.nba.com's play type keys, as nba.com labels them. */
export const PLAY_TYPE_LABELS: Record<string, string> = {
    Isolation: 'Isolation',
    Transition: 'Transition',
    PRBallHandler: 'Pick & roll ball handler',
    PRRollMan: 'Pick & roll roll man',
    Postup: 'Post up',
    Spotup: 'Spot up',
    Handoff: 'Handoff',
    Cut: 'Cut',
    OffScreen: 'Off screen',
    OffRebound: 'Putbacks',
    Misc: 'Misc',
};

export interface PlayTypeLine { key: string; label: string; freq: number | null; poss: number | null; ppp: number | null; pct: number | null }
/** One team's Synergy rows as two tables: a traded player gets one of these per team, each as published. */
export interface TeamPlayTypes {
    teamId: number;
    team: string | null;
    gp: number | null;
    offense: PlayTypeLine[];
    defense: PlayTypeLine[];
}

const lines = (rows: SynergyRow[], grouping: string): PlayTypeLine[] => rows
    .filter((r) => r.type_grouping === grouping)
    .map((r) => ({ key: r.play_type, label: PLAY_TYPE_LABELS[r.play_type] ?? r.play_type, freq: numberOrNull(r.poss_pct), poss: numberOrNull(r.poss), ppp: numberOrNull(r.ppp), pct: numberOrNull(r.percentile) }))
    .sort((a, b) => (b.freq ?? -1) - (a.freq ?? -1) || a.label.localeCompare(b.label));

/**
 * His tables, one per team, or null when the producer has no row for him (below every play type's volume floor, or the
 * season not built). stats.nba.com publishes a traded player's play types per team, each with its own percentile pool, so
 * each team keeps its own rows (nothing summed), the team he played the most games for first (most possessions on a tie).
 */
export function playTypesPanel(rows: readonly SynergyRow[]): TeamPlayTypes[] | null {
    const byTeam = new Map<number, SynergyRow[]>();
    for (const r of rows) byTeam.set(r.team_id, [...(byTeam.get(r.team_id) ?? []), r]);
    const weight = (t: SynergyRow[]) => [Math.max(...t.map((r) => numberOrNull(r.gp) ?? 0)), t.reduce((a, r) => a + (numberOrNull(r.poss) ?? 0), 0)];
    const teams = [...byTeam.values()].sort((a, b) => {
        const [wa, wb] = [weight(a), weight(b)];
        return wb[0] - wa[0] || wb[1] - wa[1];
    });
    if (!teams.length) return null;
    return teams.map((t) => ({
        teamId: t[0].team_id,
        team: t[0].team_abbreviation,
        gp: weight(t)[0] || null,
        offense: lines(t, 'Offensive'),
        defense: lines(t, 'Defensive'),
    }));
}

const POSITIONS = [['G', 'Guards'], ['F', 'Forwards'], ['C', 'Centers']] as const;

/** His matchup time on guards, forwards and centers, in that order, then the TOTAL row; null when the table has none. */
export function matchupRollup(rows: readonly MatchupRollupRow[]): { label: string; row: MatchupRollupRow }[] | null {
    const out = [...POSITIONS, ['TOTAL', 'All']].flatMap(([p, label]) => {
        const row = rows.find((r) => r.position === p);
        return row ? [{ label, row }] : [];
    });
    return out.length ? out : null;
}

/** The players he guarded most, most partial possessions first (the read's order, kept if a cache reorders). */
export function topMatchups(rows: readonly MatchupRow[]): MatchupRow[] {
    return [...rows].sort((a, b) => (numberOrNull(b.partial_poss) ?? 0) - (numberOrNull(a.partial_poss) ?? 0));
}
