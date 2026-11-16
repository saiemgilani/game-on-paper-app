/**
 * The Data API reads behind the player page's Value panel (BB-G27, behind 'bball-war'):
 * - WAR and VORP: sdv-db's `player_war` in the league's season schema (`nba_stats` / `wnba_stats` keyed by the stats.nba.com /
 *   stats.wnba.com person id, `mbb` / `wbb` by ESPN's athlete id as text; sdv-db #202, from sportsdataverse-py #1114 BB-D26),
 *   one regular-season row per player-season: rating, VORP and WAR with its 90% interval (`war_lo` / `war_hi`), and the
 *   producer's `_rank` / `_pct`;
 * - EPV added: `epv_player_seasons` in the same schemas (sdv-db #223, GOP Q39), one row per player-season from 2021-22:
 *   his epv_player_games summed by the producer (the regular season for the pros, every game in college), with the
 *   producer's `epv_own_rank` / `epv_own_pct`.
 * Every number is the producer's (rule B6): the panel reads and formats. Reads are strict and bounded by the game page's
 * read timeout, so an outage or a stall is the panel's "unavailable" line, never "no rows".
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** One row per player-season; the cap keeps a bad filter from paging. */
const WAR_LIMIT = '5';
/** The EPV tables' first season in every league (the booster's first training season): 2021-22. */
export const EPV_FIRST_SEASON = 2022;

/** Whether the season has EPV tables at all: every league from 2021-22. Earlier seasons spend no read. */
export const hasEpv = (_league: BasketballLeague, season: number) => season >= EPV_FIRST_SEASON;

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

/** One `epv_player_seasons` row: EPV added on his own events and the on-court EPV +/-, over his season's games. */
export interface EpvPlayerSeasonRow {
    season: number;
    player_id: number | string;
    team_id: number | null;
    teams: number | null;
    /** the games summed: the regular season for the pros, every game in college */
    games: number | null;
    epv_own: number | null;
    own_actions: number | null;
    off_epv_on: number | null;
    def_epv_on: number | null;
    epv_on: number | null;
    /** 1 = most EPV added; with the percentile, the producer's (a 10-player cohort floor) */
    epv_own_rank: number | null;
    epv_own_pct: number | null;
}

const read = <T>(league: BasketballLeague, table: string, query: Record<string, string>) =>
    retrieveRowsFrom<T>(leagueSource(league), table, query, TTL, true, NBA_READ_TIMEOUT_MS);

/** His `player_war` rows (one, or none before the season's build), every column: the pros' per-source spread rides along. */
export function retrievePlayerWar(league: BasketballLeague, season: number, personId: number): Promise<PlayerWarRow[]> {
    return read<PlayerWarRow>(league, 'player_war', { season: String(season), player_id: String(personId), limit: WAR_LIMIT });
}

/** His `epv_player_seasons` row (one, or none before the season's build). Call only when hasEpv. */
export function retrievePlayerEpv(league: BasketballLeague, season: number, personId: number): Promise<EpvPlayerSeasonRow[]> {
    return read<EpvPlayerSeasonRow>(league, 'epv_player_seasons', { season: String(season), player_id: String(personId), limit: WAR_LIMIT });
}
