/**
 * The Data API reads behind the NBA player page's Play types and Defense panels (BB-G19, behind 'bball-play-types'), all
 * from sdv-db's `nba_stats` (stats.nba.com's own tables, keyed by its person id), regular season only:
 * - `synergy`: his Synergy play types, offense and defense, one row per team and play type (`per_mode=totals`), with
 *   stats.nba.com's own frequency (`poss_pct`), points per possession and league percentile;
 * - `hustle_player`: his hustle line, per game;
 * - `matchups_rollup`: the share of his defensive matchup time on guards, forwards and centers, and what they scored;
 * - `matchups`: the players he guarded most, by partial possessions.
 * Every number is the producer's (rule B6): the panels read and format, and rank nothing. Reads are strict and bounded
 * by the game page's read timeout, so an outage or a stall is the panel's "unavailable" line, never "no rows". Each read
 * is filtered by season, season type, player and per-mode, with a small limit.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** Synergy and hustle start in 2015-16 (the Data API has no 2014-15 rows of either). */
export const SYNERGY_FIRST_SEASON = 2016;
/** Matchups start in 2017-18 (no 2016-17 rows in `matchups` or `matchups_rollup`). */
export const MATCHUPS_FIRST_SEASON = 2018;

/** Whether the league and season have play types at all: the NBA from 2015-16. Anything else spends no read. */
export const hasPlayTypes = (league: BasketballLeague, season: number) => league === 'nba' && season >= SYNERGY_FIRST_SEASON;
/** Whether the season has matchup tables: the NBA from 2017-18. */
export const hasMatchups = (league: BasketballLeague, season: number) => league === 'nba' && season >= MATCHUPS_FIRST_SEASON;

export interface SynergyRow {
    team_id: number;
    team_abbreviation: string | null;
    /** 'Offensive' or 'Defensive' */
    type_grouping: string;
    /** stats.nba.com's play type key: Isolation, PRBallHandler, Spotup, ... */
    play_type: string;
    gp: number | null;
    poss: number | null;
    /** the share of his possessions (defense: of the possessions he defended) */
    poss_pct: number | null;
    ppp: number | null;
    /** stats.nba.com's league percentile, 0 to 1, higher is better at both ends */
    percentile: number | null;
}
const SYNERGY_SELECT = 'team_id,team_abbreviation,type_grouping,play_type,gp,poss,poss_pct,ppp,percentile';
/** 11 offensive and 7 defensive play types a team: room for six teams, more than anyone plays for in a season. */
const SYNERGY_LIMIT = '120';

export interface HustleRow {
    g: number | null;
    min: number | null;
    deflections: number | null;
    contested_shots: number | null;
    contested_shots_3_pt: number | null;
    charges_drawn: number | null;
    def_loose_balls_recovered: number | null;
    def_boxouts: number | null;
}
const HUSTLE_SELECT = 'g,min,deflections,contested_shots,contested_shots_3_pt,charges_drawn,def_loose_balls_recovered,def_boxouts';

export interface MatchupRollupRow {
    /** G, F, C or TOTAL */
    position: string;
    percent_of_time: number | null;
    partial_poss: number | null;
    player_pts: number | null;
    matchup_fgm: number | null;
    matchup_fga: number | null;
    matchup_fg3_m: number | null;
    matchup_fg3_a: number | null;
}
const ROLLUP_SELECT = 'position,percent_of_time,partial_poss,player_pts,matchup_fgm,matchup_fga,matchup_fg3_m,matchup_fg3_a';

export interface MatchupRow {
    off_player_id: number;
    off_player_name: string | null;
    gp: number | null;
    partial_poss: number | null;
    player_pts: number | null;
    matchup_fgm: number | null;
    matchup_fga: number | null;
    matchup_fg3_m: number | null;
    matchup_fg3_a: number | null;
}
const MATCHUP_SELECT = 'off_player_id,off_player_name,gp,partial_poss,player_pts,matchup_fgm,matchup_fga,matchup_fg3_m,matchup_fg3_a';
/** The panel lists his most-guarded players: the read stops there. */
export const TOP_MATCHUPS = 8;

const read = <T>(table: string, query: Record<string, string>) =>
    retrieveRowsFrom<T>(leagueSource('nba'), table, { season_type: 'regular-season', ...query }, TTL, true, NBA_READ_TIMEOUT_MS);

/** His Synergy rows for the season, offense and defense, every team. Call only when hasPlayTypes. */
export function retrievePlayerSynergy(season: number, personId: number): Promise<SynergyRow[]> {
    return read<SynergyRow>('synergy', { season: String(season), player_id: String(personId), per_mode: 'totals', select: SYNERGY_SELECT, limit: SYNERGY_LIMIT });
}

/** His hustle row (one a season), per game. Call only when hasPlayTypes. */
export function retrievePlayerHustle(season: number, personId: number): Promise<HustleRow[]> {
    return read<HustleRow>('hustle_player', { season: String(season), player_id: String(personId), per_mode: 'pergame', select: HUSTLE_SELECT, limit: '5' });
}

/** His matchup time by position (G, F, C and the TOTAL row), season totals. Call only when hasMatchups. */
export function retrievePlayerMatchupRollup(season: number, personId: number): Promise<MatchupRollupRow[]> {
    return read<MatchupRollupRow>('matchups_rollup', { season: String(season), def_player_id: String(personId), per_mode: 'totals', select: ROLLUP_SELECT, limit: '10' });
}

/** The players he guarded most, by partial possessions, season totals. Call only when hasMatchups. */
export function retrievePlayerTopMatchups(season: number, personId: number): Promise<MatchupRow[]> {
    return read<MatchupRow>('matchups', { season: String(season), def_player_id: String(personId), per_mode: 'totals', order: '-partial_poss', select: MATCHUP_SELECT, limit: String(TOP_MATCHUPS) });
}
