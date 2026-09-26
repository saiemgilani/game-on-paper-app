/**
 * Nearby-rank lists ('rank-neighbors'): for one metric, the entities the
 * producer ranked within `span` places of this one. Ranks are the producer's
 * `<metric>_rank` (null for a non-qualifier) and are never recomputed here.
 *
 * Keys are strings on purpose: NFL team ids arrive as numbers, CFB team ids as
 * strings, NFL player ids as gsis strings, CFB player ids as numbers. A traded
 * player has one row per team, so a player key is `player:team`.
 */
import { cleanField, formatRank, generateTeamMetricTitle, numberOrNull, roundNumber } from './misc';
import { SDV_PLAYER_METRIC_CATEGORIES } from './constants';
import { formatPlayerMetric, PLAYER_NAME_FIELD, playerHref, type PlayerCategory } from './players';
import { leaguePath, type League } from './league';

export type Row = Record<string, any>;
export const teamKey = (r: Row): string => String(r.team_id);
export const playerKey = (r: Row): string => `${r.player_id}:${r.team_id}`;

export interface Neighbor { key: string; rank: number; value: number; row: Row; self: boolean }

export function neighborWindow(rows: Row[], keyOf: (r: Row) => string, selfKey: string | number, metric: string, span = 5): Neighbor[] {
    const id = String(selfKey);
    const self = rows.find((r) => keyOf(r) === id);
    const selfRank = self ? numberOrNull(self[`${metric}_rank`]) : null;
    if (selfRank === null) return [];
    const out: Neighbor[] = [];
    for (const r of rows) {
        const rank = numberOrNull(r[`${metric}_rank`]);
        const value = numberOrNull(r[metric]);
        if (rank === null || value === null || Math.abs(rank - selfRank) > span) continue;
        out.push({ key: keyOf(r), rank, value, row: r, self: keyOf(r) === id });
    }
    return out.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
}

/** The six team metrics the team-season page lists, each in the leaderboards' own format. */
export const TEAM_NEIGHBOR_METRICS: { key: string; format: [number, number, number]; pct: boolean }[] = [
    { key: 'net_adj_epa', format: [1, 2, 2], pct: false },
    { key: 'EPAplay_off', format: [1, 2, 2], pct: false },
    { key: 'success_off', format: [100, 2, 1], pct: true },
    { key: 'explosive_off', format: [100, 2, 1], pct: true },
    { key: 'EPAplay_def', format: [1, 2, 2], pct: false },
    { key: 'success_def', format: [100, 2, 1], pct: true },
];

/** Per player category, the metrics listed; keys and titles are the season leaderboards'. */
export const PLAYER_NEIGHBOR_METRICS: Record<PlayerCategory, string[]> = {
    passing: ['EPAplay', 'success', 'yardsdropback', 'TEPA'],
    rushing: ['EPAplay', 'success', 'yardsplay', 'TEPA'],
    receiving: ['EPAplay', 'success', 'yardsplay', 'TEPA'],
};

export interface NeighborCell { key: string; rank: string; label: string; href: string | null; teamId: string; value: string; self: boolean }
export interface NeighborList { metric: string; title: string; rows: NeighborCell[] }

export function teamNeighborLists(rows: any[], teamId: string | number, league: League, season: number): NeighborList[] {
    return TEAM_NEIGHBOR_METRICS.map(({ key, format: [mult, p10, fixed], pct }) => ({
        metric: key,
        title: generateTeamMetricTitle(key),
        rows: neighborWindow(rows, teamKey, teamId, key).map((n) => ({
            key: n.key,
            rank: formatRank(n.rank),
            label: cleanField(n.row, 'pos_team'),
            href: leaguePath(league, `/year/${season}/team/${n.row.team_id}`),
            teamId: String(n.row.team_id),
            value: roundNumber(n.value * mult, p10, fixed) + (pct ? '%' : ''),
            self: n.self,
        })),
    })).filter((l) => l.rows.length > 0);
}

export function playerNeighborLists(rows: any[], selfKey: string, category: PlayerCategory,
    locals: { league?: League; preview?: boolean; flagOverrides?: Record<string, boolean> }, season: number): NeighborList[] {
    return PLAYER_NEIGHBOR_METRICS[category].map((key) => ({
        metric: key,
        title: SDV_PLAYER_METRIC_CATEGORIES[category][key],
        rows: neighborWindow(rows, playerKey, selfKey, key).map((n) => ({
            // the highlight key is the PLAYER, so a traded player lights up whichever team row a list holds
            key: String(n.row.player_id),
            rank: formatRank(n.rank),
            label: cleanField(n.row, PLAYER_NAME_FIELD[category]),
            href: playerHref(n.row.player_id, locals, season),
            teamId: String(n.row.team_id),
            value: formatPlayerMetric(category, key, n.value),
            self: n.self,
        })),
    })).filter((l) => l.rows.length > 0);
}
