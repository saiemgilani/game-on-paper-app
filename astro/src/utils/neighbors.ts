/**
 * Nearby-rank lists ('rank-neighbors'): for one metric, the entities the
 * producer ranked within `span` places of this one. Ranks are the producer's
 * `<metric>_rank` (null for a non-qualifier) and are never recomputed here.
 *
 * Keys are strings on purpose: NFL team ids arrive as numbers, CFB team ids as
 * strings, NFL player ids as gsis strings, CFB player ids as numbers. A traded
 * player has one row per team, so a player key is `player:team`.
 */
import { numberOrNull } from './misc';

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
