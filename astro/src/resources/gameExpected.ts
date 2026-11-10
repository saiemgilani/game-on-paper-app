/**
 * The Data API read behind BB-G33's expected points on a Data API final (behind 'bball-situational-box'): sdv-db's
 * `{lg}.game_team_expected` (BB-D40, sdv-db #215) in the league's ESPN-keyed games schema, one row a team, each game scored
 * against the league's shot cells as of its own date. A live game (and a final not ingested yet) carries the same row in
 * the processor payload instead. A season the producer has not built has no rows: the panel says so. Strict: an outage is
 * never a game with no expected points.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { TEAM_EXPECTED_KEYS, teamExpected, type NbaTeamExpected } from './nbaGame';
import type { BasketballLeague } from '../utils/league';

/** Rebuilt per season with the nightly products (16:00 UTC): the season pages' window. */
const TTL = 6 * 60 * 60;
/** Two rows a game; the cap keeps a bad filter from paging silently. */
const LIMIT = '4';
const SELECT = ['team_id', ...TEAM_EXPECTED_KEYS].join(',');

/** Each side's row by the ESPN team id; absent when the season is not built (or the side has no row). */
export interface GameExpected { home?: NbaTeamExpected; away?: NbaTeamExpected }

type Row = Record<string, unknown>;

/** Both sides' rows of one game's read. */
export function gameExpected(rows: readonly Row[], homeId: number, awayId: number): GameExpected {
    if (rows.length > 2) throw new Error(`game_team_expected: ${rows.length} rows for one game`);
    const side = (id: number) => { const r = rows.find((x) => Number(x.team_id) === id); return r ? teamExpected(r) : undefined; };
    const home = side(homeId), away = side(awayId);
    return { ...(home ? { home } : {}), ...(away ? { away } : {}) };
}

/** The readPanel signature: league, season, ESPN game id, home and away ESPN ids. */
export async function retrieveGameExpected(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<GameExpected> {
    const rows = await retrieveRowsFrom<Row>(BASKETBALL[league].gamesSource, 'game_team_expected', { season: String(season), game_id: espnGameId, select: SELECT, limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
    return gameExpected(rows, homeId, awayId);
}
