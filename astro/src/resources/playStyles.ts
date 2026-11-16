/**
 * The Data API reads behind the play-style chips (BB-G17, behind 'bball-play-styles'): sdv-db's play-style tables (BB-D20,
 * sdv-db #200), written by sdv-py's nba_player_play_styles / nba_team_play_styles / mbb_play_styles (#1112).
 * - NBA players: `nba_stats.player_play_styles`, keyed by the stats.nba.com person id (the page's id): an offensive
 *   archetype (2015-16 on) and a defensive one (2017-18 on).
 * - NBA teams: `nba_stats.team_play_styles`, defense only. sdv-py publishes no team offense archetype: its clusters did not
 *   beat a no-structure null on the holdout seasons.
 * - College players: `mbb.player_play_styles` / `wbb.player_play_styles`, keyed by ESPN's athlete id (the page's id), one
 *   box-based archetype per team the player played for (2024-25 on).
 * - WNBA: no table, so no read.
 * Every label, runner-up and margin is the producer's. Reads are strict and bounded by the game page's read timeout, so an
 * outage or a stall is the chips' "unavailable" line, never a player with no style.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** One row per NBA player-season or team-season, one per team in college; the cap keeps a bad filter from paging. */
const LIMIT = '5';

/** The leagues with player play styles (no WNBA table). */
export const PLAYER_PLAY_STYLE_LEAGUES: readonly BasketballLeague[] = ['nba', 'mbb', 'wbb'];

/** One producer row, as read: the chips pick their columns by prefix (utils/playStyles.ts). */
export type PlayStyleRow = Record<string, unknown>;

const STYLE = (p: string) => [`${p}archetype`, `${p}second_archetype`, `${p}margin`];
const NBA_PLAYER_SELECT = [...STYLE('off_'), ...STYLE('def_')].join(',');
const COLLEGE_PLAYER_SELECT = ['min', ...STYLE('')].join(',');
const NBA_TEAM_SELECT = STYLE('def_').join(',');

const read = (league: BasketballLeague, table: string, query: Record<string, string>) =>
    retrieveRowsFrom<PlayStyleRow>(leagueSource(league), table, { ...query, limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);

/** The player's season rows: one for the NBA, one per team in college. Call only for PLAYER_PLAY_STYLE_LEAGUES. */
export function retrievePlayerPlayStyle(league: BasketballLeague, season: number, personId: number): Promise<PlayStyleRow[]> {
    const select = league === 'nba' ? NBA_PLAYER_SELECT : COLLEGE_PLAYER_SELECT;
    return read(league, 'player_play_styles', { season: String(season), player_id: String(personId), select });
}

/** An NBA team-season's defensive row, keyed by the stats.nba.com team id (the page's id). */
export function retrieveTeamPlayStyle(season: number, teamId: number): Promise<PlayStyleRow[]> {
    return read('nba', 'team_play_styles', { season: String(season), team_id: String(teamId), select: NBA_TEAM_SELECT });
}
