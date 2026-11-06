/**
 * The Data API reads behind the player page's Value panel (BB-G27, behind 'bball-war'):
 * - WAR and VORP: sdv-db's `player_war` in the league's season schema (`nba_stats` / `wnba_stats` keyed by the stats.nba.com /
 *   stats.wnba.com person id, `mbb` / `wbb` by ESPN's athlete id as text; sdv-db #202, from sportsdataverse-py #1114 BB-D26),
 *   one regular-season row per player-season: rating, VORP and WAR with its 90% interval (`war_lo` / `war_hi`), and the
 *   producer's `_rank` / `_pct`;
 * - EPV added: `nba_stats.epv_player_games` (BB-D24, NBA only, 2021-22 on), one row per game he played.
 * Every number is the producer's (rule B6): the panel reads and formats, except the EPV season line, which adds up his
 * regular-season games (utils/playerWar.ts epvSeason). Reads are strict and bounded by the game page's read timeout, so
 * an outage or a stall is the panel's "unavailable" line, never "no rows".
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** One row per player-season; the cap keeps a bad filter from paging. */
const WAR_LIMIT = '5';
/** Every game of his season the EPV tables score: preseason, regular season, All-Star, play-in and playoffs (at most ~115). */
const EPV_LIMIT = '130';
/** The EPV booster's first training season (sdv-py nba_epv refuses earlier ones): 2021-22. */
export const EPV_FIRST_SEASON = 2022;

/** Whether the league and season have EPV tables at all: the NBA from 2021-22. Anything else spends no read. */
export const hasEpv = (league: BasketballLeague, season: number) => league === 'nba' && season >= EPV_FIRST_SEASON;

/** One `player_war` row. The pros add `rating_` / `war_` `bpm`, `rapm` and `boban` (the headline is their mean). */
export interface PlayerWarRow {
    season: number;
    player_id: number | string;
    player_name: string | null;
    /** how many teams he played for */
    teams: number | null;
    min: number | null;
    /** on-court possessions, offensive plus defensive over 2 */
    poss: number | null;
    /** points per 100 possessions above a league-average player */
    rating: number | null;
    vorp: number | null;
    war: number | null;
    /** a nominal 90% interval from a bootstrap over each team-season's games */
    war_lo: number | null;
    war_hi: number | null;
    vorp_rank: number | null;
    vorp_pct: number | null;
    war_rank: number | null;
    war_pct: number | null;
    rating_bpm?: number | null;
    rating_rapm?: number | null;
    rating_boban?: number | null;
    war_bpm?: number | null;
    war_rapm?: number | null;
    war_boban?: number | null;
}

/** One game's EPV: added on his own events, and the team's EPV +/- while he was on the floor. */
export interface EpvPlayerGameRow {
    game_id: string;
    epv_own: number | null;
    own_actions: number | null;
    epv_on: number | null;
}
const EPV_SELECT = 'game_id,epv_own,own_actions,epv_on';

const read = <T>(league: BasketballLeague, table: string, query: Record<string, string>) =>
    retrieveRowsFrom<T>(leagueSource(league), table, query, TTL, true, NBA_READ_TIMEOUT_MS);

/** His `player_war` rows (one, or none before the season's build), every column: the pros' per-source spread rides along. */
export function retrievePlayerWar(league: BasketballLeague, season: number, personId: number): Promise<PlayerWarRow[]> {
    return read<PlayerWarRow>(league, 'player_war', { season: String(season), player_id: String(personId), limit: WAR_LIMIT });
}

/** His EPV game rows for the season, every game type (the page keeps the regular season). Call only when hasEpv. */
export function retrievePlayerEpv(league: BasketballLeague, season: number, personId: number): Promise<EpvPlayerGameRow[]> {
    return read<EpvPlayerGameRow>(league, 'epv_player_games', { season: String(season), player_id: String(personId), select: EPV_SELECT, limit: EPV_LIMIT });
}
