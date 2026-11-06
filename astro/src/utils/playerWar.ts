/**
 * The Value panel's pure steps (BB-G27): his `player_war` row as the panel's lines, and his EPV season from the game rows.
 * WAR always travels with its 90% interval: the panel never prints a WAR without `war_lo` / `war_hi` next to it, and says
 * so when the producer ships none. Ranks and percentiles are the producer's `_rank` / `_pct` (rule B6).
 */
import type { EpvPlayerGameRow, PlayerWarRow } from '../resources/playerWar';
import { numberOrNull } from './misc';

export interface WarCell { value: number | null; rank: number | null; pct: number | null }
export interface WarPanel {
    war: WarCell & { lo: number | null; hi: number | null };
    vorp: WarCell;
    rating: number | null;
    poss: number | null;
    min: number | null;
    teams: number | null;
    /** NBA/WNBA: each source's WAR (BPM, RAPM, BOBAN); the headline is their mean. Empty in college. */
    sources: { label: string; war: number | null }[];
    ranked: boolean;
}

const SOURCES = [['BPM', 'bpm'], ['RAPM', 'rapm'], ['BOBAN', 'boban']] as const;

/** His panel, or null when the producer has no row for him (the season is not built yet, or he did not play). */
export function warPanel(rows: readonly PlayerWarRow[]): WarPanel | null {
    const row = rows[0];
    if (!row) return null;
    const cell = (m: 'war' | 'vorp'): WarCell => ({ value: numberOrNull(row[m]), rank: numberOrNull(row[`${m}_rank`]), pct: numberOrNull(row[`${m}_pct`]) });
    const sources = SOURCES
        .map(([label, s]) => ({ label, war: numberOrNull(row[`war_${s}`]) }))
        .filter((s) => s.war != null);
    const war = { ...cell('war'), lo: numberOrNull(row.war_lo), hi: numberOrNull(row.war_hi) };
    const vorp = cell('vorp');
    return {
        war, vorp, sources,
        rating: numberOrNull(row.rating),
        poss: numberOrNull(row.poss),
        min: numberOrNull(row.min),
        teams: numberOrNull(row.teams),
        ranked: war.rank != null || vorp.rank != null,
    };
}

export interface EpvSeason { games: number; epvOwn: number; ownActions: number; epvOn: number }

/** stats.nba.com game ids: `002` is the regular season (`001` preseason, `003` All-Star, `004` playoffs, `005` play-in). */
const REGULAR = /^002/;

/**
 * His regular-season EPV: the sums of his game rows (EPV added and on-court EPV +/- are sums like +/-, so a season is the
 * sum of its games). Null when he has no regular-season game in the table.
 * ponytail: summed here because sdv-db ships no player-season EPV table; read it instead once one exists.
 */
export function epvSeason(rows: readonly EpvPlayerGameRow[]): EpvSeason | null {
    const games = rows.filter((r) => REGULAR.test(String(r.game_id)));
    if (games.length === 0) return null;
    const sum = (k: 'epv_own' | 'own_actions' | 'epv_on') => games.reduce((a, r) => a + (numberOrNull(r[k]) ?? 0), 0);
    return { games: games.length, epvOwn: sum('epv_own'), ownActions: sum('own_actions'), epvOn: sum('epv_on') };
}
