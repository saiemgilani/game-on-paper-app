/**
 * The Data API read behind BB-G35's "against their average" (behind 'bball-game-leaders'): each side's season per-game
 * averages from the ESPN-keyed `{lg}.player_season_stats` (the game page's own athlete ids, all four leagues). The table
 * is long, one row per athlete and stat (`category`, `stat_name`, `value`), so it is read per team and pivoted here.
 * Strict, as the other game panels: an outage is never a team with no averages.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';
import type { SeasonAverage } from '../utils/gameLeaders';

/** The season tables' window, as the Impact box. */
const TTL = 6 * 60 * 60;
/** A roster's every stat row (~20 players x ~70 stats); a read at the cap is truncated, so it fails loud. */
const LIMIT = '5000';
const SELECT = 'athlete_id,category,stat_name,value';
/** ESPN's per-game stat names (all in the `averages` category, with `gamesPlayed`). */
const STAT: Record<string, keyof Omit<SeasonAverage, 'athleteId'>> = { gamesPlayed: 'gp', avgPoints: 'pts', avgRebounds: 'reb', avgAssists: 'ast' };

/**
 * The most games a player can have in one season. Some WNBA and WBB rows carry a career line under the season filter
 * (WNBA 2025: 436 games played; WBB 2026: 82 to 107), and those are not the season's average, so they are left out.
 * ponytail: a fixed ceiling per league; replace it with the producer's fix once player_season_stats is season-only.
 */
const SEASON_GAMES: Record<BasketballLeague, number> = { nba: 82, wnba: 44, mbb: 45, wbb: 45 };

/**
 * The leagues whose "against their average" section is drawn. WNBA and WBB `player_season_stats` carry career lines under the
 * season filter, so the section is hidden there until the producer writes season-only rows.
 * ponytail: add 'wnba' and 'wbb' back once the producer fix is republished.
 */
export const AVERAGES_LEAGUES: ReadonlySet<BasketballLeague> = new Set(['nba', 'mbb']);

type Row = Record<string, unknown>;

/** The long rows to one average per athlete; an athlete without games played, or with more than a season's, is left out. */
export function pivotSeasonAverages(rows: readonly Row[], league: BasketballLeague): SeasonAverage[] {
    const by = new Map<number, SeasonAverage>();
    for (const r of rows) {
        const key = STAT[String(r.stat_name)];
        const id = Number(r.athlete_id), v = r.value == null || r.value === '' ? NaN : Number(r.value);
        if (!key || !Number.isFinite(id) || !Number.isFinite(v)) continue;
        const a = by.get(id) ?? { athleteId: id, gp: 0, pts: null, reb: null, ast: null };
        if (key === 'gp') a.gp = Math.max(a.gp, v);
        else a[key] = v;
        by.set(id, a);
    }
    return [...by.values()].filter((a) => a.gp > 0 && a.gp <= SEASON_GAMES[league]);
}

/** Both sides' averages for one ESPN game (the readPanel signature: league, season, ESPN game id, home id, away id). */
export async function retrieveSeasonAverages(league: BasketballLeague, season: number, _espnGameId: string, homeId: number, awayId: number): Promise<SeasonAverage[]> {
    const read = async (teamId: number) => {
        const rows = await retrieveRowsFrom<Row>(BASKETBALL[league].gamesSource, 'player_season_stats', { season: String(season), team_id: String(teamId), select: SELECT, limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
        if (rows.length >= Number(LIMIT)) throw new Error(`player_season_stats: ${rows.length} rows for team ${teamId}, at the ${LIMIT} cap`);
        return rows;
    };
    const [home, away] = await Promise.all([read(homeId), read(awayId)]);
    return pivotSeasonAverages([...home, ...away], league);
}
