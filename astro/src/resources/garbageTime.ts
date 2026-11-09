/**
 * The Data API read behind the game page's garbage-time toggle (BB-G2, behind 'bball-garbage-time'): the game's
 * possession log with the producer's `is_garbage_time` flag. The pros read `{nba,wnba}_stats.possessions` by the stats
 * game id (the schedule_crosswalk read BB-G1 already makes, same query and cache entry); college reads
 * `{mbb,wbb}.ncaa_possessions` by the ESPN game id. Strict like the Impact box: an outage is never a game with no log.
 *
 * The pro read names no columns, so a release published before BB-D7's flags (hoopR-nba-stats-data #54,
 * wehoop-wnba-stats-data #28) still answers, without them; the page then shows no toggle (utils/garbageTime.ts
 * hasGarbageFlag). College's log has always carried bigballR's flag.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { retrieveProGame } from './impactBox';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** As the Impact box: the season products' window. */
const TTL = 6 * 60 * 60;
/** A game is ~200 possessions (more with overtimes); the cap keeps a bad filter from paging silently. */
const POSSESSION_LIMIT = '400';
const NCAA_SELECT = ['period', 'poss_num', 'poss_team', 'home', 'pts', 'is_garbage_time', 'last_event_time', 'poss_team_espn_team_id', 'home_espn_team_id', 'away_espn_team_id',
    ...['home', 'away'].flatMap((s) => [1, 2, 3, 4, 5].map((i) => `${s}_${i}_player_id`))].join(',');

export interface GarbageReads {
    /** the possession log's team id of each ESPN side (stats ids for the pros, ESPN ids in college); null when unmapped */
    teams: { home: number; away: number } | null;
    rows: Record<string, any>[];
}

/** The log for one ESPN game; no teams and no rows when it is not mapped (the pros' crosswalk has no row). */
export async function retrieveGarbageTime(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<GarbageReads> {
    const read = async (table: string, q: Record<string, string>) => {
        const rows = await retrieveRowsFrom<Record<string, any>>(leagueSource(league), table, { season: String(season), ...q, limit: POSSESSION_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
        // a log cut at the cap would split part of the game: a failed read, never a short one
        if (rows.length >= Number(POSSESSION_LIMIT)) throw new Error(`${table}: ${rows.length} rows, at the ${POSSESSION_LIMIT} cap`);
        return rows;
    };
    if (PRO_LEAGUES.includes(league)) {
        const x = await retrieveProGame(league, season, espnGameId);
        return x ? { teams: x.teams, rows: await read('possessions', { game_id: x.gameId }) } : { teams: null, rows: [] };
    }
    return { teams: { home: homeId, away: awayId }, rows: await read('ncaa_possessions', { espn_game_id: espnGameId, select: NCAA_SELECT }) };
}
