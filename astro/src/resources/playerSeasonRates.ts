/**
 * The Data API read behind BB-G34's "Vs average" view (behind 'bball-player-box-views'): each side's season scoring rate
 * from the ESPN-keyed `{lg}.player_season_stats` (the game page's own athlete ids, all four leagues). The table is long,
 * one row per athlete and stat (`stat_name`, `value`), so it is read per team and pivoted here. Strict, as the other game
 * panels: an outage is never a team with no averages.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';

/** The season tables' window, as the Impact box. */
const TTL = 6 * 60 * 60;
/** A roster's every stat row (~20 players x ~70 stats); a read at the cap is truncated, so it fails loud. */
const LIMIT = '5000';
const SELECT = 'athlete_id,stat_name,value';

/** One player's season line: games played, minutes and points per game. */
export interface PlayerSeasonRate { athleteId: number; gp: number; min: number | null; pts: number | null }

const STAT: Record<string, 'gp' | 'min' | 'pts'> = { gamesPlayed: 'gp', avgMinutes: 'min', avgPoints: 'pts' };

/**
 * The most games a player can have in one season. Some WNBA and WBB rows carry a career line under the season filter
 * (WNBA 2025: 436 games played; WBB 2026: 82 to 107; being republished), and a career line is not the season's rate.
 * ponytail: a fixed ceiling per league, the same as BB-G35's; drop it once player_season_stats is season-only everywhere.
 */
const SEASON_GAMES: Record<BasketballLeague, number> = { nba: 82, wnba: 44, mbb: 45, wbb: 45 };

type Row = Record<string, unknown>;

/** The long rows to one line per athlete; no games played, or more than a season holds, is left out. */
export function pivotPlayerSeasonRates(rows: readonly Row[], league: BasketballLeague): PlayerSeasonRate[] {
    const by = new Map<number, PlayerSeasonRate>();
    for (const r of rows) {
        const key = STAT[String(r.stat_name)];
        const id = Number(r.athlete_id), v = r.value == null || r.value === '' ? NaN : Number(r.value);
        if (!key || !Number.isFinite(id) || !Number.isFinite(v)) continue;
        const a = by.get(id) ?? { athleteId: id, gp: 0, min: null, pts: null };
        if (key === 'gp') a.gp = Math.max(a.gp, v);
        else a[key] = v;
        by.set(id, a);
    }
    return [...by.values()].filter((a) => a.gp > 0 && a.gp <= SEASON_GAMES[league]);
}

/** Both sides' lines for one ESPN game (the readPanel signature: league, season, ESPN game id, home id, away id). */
export async function retrievePlayerSeasonRates(league: BasketballLeague, season: number, _espnGameId: string, homeId: number, awayId: number): Promise<PlayerSeasonRate[]> {
    const read = async (teamId: number) => {
        const rows = await retrieveRowsFrom<Row>(BASKETBALL[league].gamesSource, 'player_season_stats', { season: String(season), team_id: String(teamId), select: SELECT, limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
        if (rows.length >= Number(LIMIT)) throw new Error(`player_season_stats: ${rows.length} rows for team ${teamId}, at the ${LIMIT} cap`);
        return rows;
    };
    const [home, away] = await Promise.all([read(homeId), read(awayId)]);
    return pivotPlayerSeasonRates([...home, ...away], league);
}
