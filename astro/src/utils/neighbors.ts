/**
 * Nearby-rank lists ('rank-neighbors'): for one metric, the entities the
 * producer ranked within `span` places of this one. Ranks are the producer's
 * `<metric>_rank` (null for a non-qualifier) and are never recomputed here.
 *
 * Keys are strings on purpose: ids arrive inconsistently typed across leagues
 * and endpoints -- CFB team ids arrive as numbers too, not strings, and NFL
 * player ids as gsis strings -- so every key is coerced via `String()` rather
 * than compared by its source type. A traded player has one row per team, so
 * a player key is `player:team`.
 */
import { cleanField, formatRank, generateCategoryForMetric, generateMarginalString, generateTeamMetricTitle, numberOrNull, roundNumber } from './misc';
import { SDV_PLAYER_METRIC_CATEGORIES, SDV_TEAM_METRIC_FORMATTING_VALUES, SDV_TEAM_PERCENT_COLUMNS } from './constants';
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

/** The six team metrics the team-season page lists, in the leaderboards' own order. */
export const TEAM_NEIGHBOR_METRICS: string[] = ['net_adj_epa', 'EPAplay_off', 'success_off', 'explosive_off', 'EPAplay_def', 'success_def'];

/**
 * explosive_off/explosive_def carry no entry in SDV_TEAM_METRIC_FORMATTING_VALUES under
 * either the offensive or defensive category -- fall back to the same [mult, power10,
 * fixed] every other percent-rate metric in their category uses (e.g. success_off/success_def).
 */
const TEAM_METRIC_FORMAT_FALLBACK: Record<string, [number, number, number]> = {
    explosive_off: [100, 2, 1],
    explosive_def: [100, 2, 1],
};

/** Per player category, the metrics listed; keys and titles are the season leaderboards'. */
export const PLAYER_NEIGHBOR_METRICS: Record<PlayerCategory, string[]> = {
    passing: ['EPAplay', 'success', 'yardsdropback', 'TEPA'],
    rushing: ['EPAplay', 'success', 'yardsplay', 'TEPA'],
    receiving: ['EPAplay', 'success', 'yardsplay', 'TEPA'],
};

export interface NeighborCell { key: string; rank: string; label: string; href: string | null; teamId: string; value: string; self: boolean }
export interface NeighborList { metric: string; title: string; rows: NeighborCell[] }

export function teamNeighborLists(rows: any[], teamId: string | number, league: League, season: number): NeighborList[] {
    return TEAM_NEIGHBOR_METRICS.map((key) => {
        // mirrors TeamLeaderboardTable.astro's generateMetricCell: category comes from the
        // metric name, the leaderboard's own [mult, power10, fixed] comes from that category,
        // and a differential renders with generateMarginalString (the leading "+"/"-"), never roundNumber
        const category = generateCategoryForMetric(key).toLowerCase();
        const [mult, p10, fixed] = SDV_TEAM_METRIC_FORMATTING_VALUES[category]?.[key] ?? TEAM_METRIC_FORMAT_FALLBACK[key] ?? [1, 2, 2];
        const pct = SDV_TEAM_PERCENT_COLUMNS.includes(key);
        return {
            metric: key,
            title: generateTeamMetricTitle(key),
            rows: neighborWindow(rows, teamKey, teamId, key).map((n) => {
                const value = n.value * mult;
                const valString = category === 'differential' ? generateMarginalString(value, p10, fixed) : roundNumber(value, p10, fixed);
                return {
                    key: n.key,
                    rank: formatRank(n.rank),
                    label: cleanField(n.row, 'pos_team'),
                    href: leaguePath(league, `/year/${season}/team/${n.row.team_id}`),
                    teamId: String(n.row.team_id),
                    value: valString + (pct ? '%' : ''),
                    self: n.self,
                };
            }),
        };
    }).filter((l) => l.rows.length > 0);
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
