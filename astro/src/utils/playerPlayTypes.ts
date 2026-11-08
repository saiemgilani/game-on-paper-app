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
export interface PlayTypesPanel {
    team: string | null;
    gp: number | null;
    /** the other teams he has Synergy rows for this season (not shown) */
    otherTeams: string[];
    offense: PlayTypeLine[];
    defense: PlayTypeLine[];
}

const lines = (rows: SynergyRow[], grouping: string): PlayTypeLine[] => rows
    .filter((r) => r.type_grouping === grouping)
    .map((r) => ({ key: r.play_type, label: PLAY_TYPE_LABELS[r.play_type] ?? r.play_type, freq: numberOrNull(r.poss_pct), poss: numberOrNull(r.poss), ppp: numberOrNull(r.ppp), pct: numberOrNull(r.percentile) }))
    .sort((a, b) => (b.freq ?? -1) - (a.freq ?? -1) || a.label.localeCompare(b.label));

/**
 * His panel, or null when the producer has no row for him (below every play type's volume floor, or the season not built).
 * stats.nba.com publishes a traded player's play types per team, so the panel shows the team he played the most games
 * for (most possessions on a tie) and names the others; adding teams up would mix two percentile pools.
 */
export function playTypesPanel(rows: readonly SynergyRow[]): PlayTypesPanel | null {
    const byTeam = new Map<number, SynergyRow[]>();
    for (const r of rows) byTeam.set(r.team_id, [...(byTeam.get(r.team_id) ?? []), r]);
    const weight = (t: SynergyRow[]) => [Math.max(...t.map((r) => numberOrNull(r.gp) ?? 0)), t.reduce((a, r) => a + (numberOrNull(r.poss) ?? 0), 0)];
    const teams = [...byTeam.values()].sort((a, b) => {
        const [wa, wb] = [weight(a), weight(b)];
        return wb[0] - wa[0] || wb[1] - wa[1];
    });
    const mine = teams[0];
    if (!mine) return null;
    return {
        team: mine[0].team_abbreviation,
        gp: weight(mine)[0] || null,
        otherTeams: teams.slice(1).map((t) => t[0].team_abbreviation ?? '').filter(Boolean),
        offense: lines(mine, 'Offensive'),
        defense: lines(mine, 'Defensive'),
    };
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
