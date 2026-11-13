/**
 * The Data API read behind the game page's player props panel (BB-G44, behind 'bball-props'): sdv-db's
 * `{nba,wnba,mbb}.player_props` (BB-D33) for one ESPN game, a row per player and stat. Women's college has no props
 * upstream, so it is never read. The ESPN-keyed schema (`gamesSource`, `nba` not `nba_stats`). Strict: an outage is never a game with no lines.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';

export const PROPS_LEAGUES: readonly BasketballLeague[] = ['nba', 'wnba', 'mbb'];
export type PropStat = 'points' | 'rebounds' | 'assists' | 'threes' | 'pra';
export interface PropRow {
    athlete_id: number | null; team_id: number | null; player_name: string; stat: PropStat | string
    line: number | null; n_books: number | null; over_price: number | null; under_price: number | null; over_prob: number | null
}

/** The lines follow the nightly odds ingest. */
const TTL = 6 * 60 * 60;
/** Two rosters by five stats is ~130 rows; the cap keeps a bad filter from paging silently. */
const LIMIT = '300';
const SELECT = 'athlete_id,team_id,player_name,stat,line,n_books,over_price,under_price,over_prob';

export async function retrievePlayerProps(league: BasketballLeague, season: number, espnGameId: string): Promise<PropRow[]> {
    const rows = await retrieveRowsFrom<PropRow>(BASKETBALL[league].gamesSource, 'player_props', { season: String(season), game_id: espnGameId, select: SELECT, limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
    if (rows.length >= Number(LIMIT)) throw new Error(`player_props: ${rows.length} rows, at the ${LIMIT} cap`);
    return rows;
}
