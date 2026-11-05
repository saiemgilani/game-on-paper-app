/**
 * The Data API reads behind the basketball nearby-rank lists (BB-G12, behind 'bball-rank-neighbors'), football's S3
 * (`rank-neighbors`) on the basketball team and player pages. One season-wide read per page kind, the same URL for every
 * team (or player) page of a season, so one cache entry:
 * - teams: `team_strength` (`nba_stats` / `wnba_stats` keyed by the stats team id; `mbb` / `wbb` by ESPN's), whose
 *   `<m>_rank` columns are sdv-py's (1 = best);
 * - players (NBA/WNBA only): `player_stats_advanced`, the regular season's row per player, whose `<m>_rank` columns are
 *   stats.nba.com's / stats.wnba.com's own. `player_impact` carries no ranks and the college tables none the site can key.
 * Ranks are never recomputed here. Reads are strict and bounded by the game page's read timeout, so an outage or a stalled
 * request is the section's "unavailable" line, never an empty list or a held page.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** D-I is about 365 teams; an NBA regular season about 600 players. The caps keep a bad filter from paging silently. */
const TEAM_LIMIT = '400';
const PLAYER_LIMIT = '1000';

/** The team lists, in the team page's season-block order. */
export const TEAM_RANKED = ['net_rtg', 'off_rtg', 'def_rtg', 'adj_net_rtg', 'efg_pct', 'opp_efg_pct'] as const;
/** The player lists. */
export const PLAYER_RANKED = ['net_rating', 'ts_pct', 'usg_pct', 'pie'] as const;

export type RankRow = Record<string, unknown>;

const ranked = (cols: readonly string[]) => cols.flatMap((c) => [c, `${c}_rank`]);

export function retrieveTeamRankRows(league: BasketballLeague, season: number): Promise<RankRow[]> {
    const select = ['team_id', ...ranked(TEAM_RANKED)].join(',');
    return retrieveRowsFrom<RankRow>(leagueSource(league), 'team_strength', { season: String(season), select, limit: TEAM_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
}

export function retrievePlayerRankRows(league: BasketballLeague, season: number): Promise<RankRow[]> {
    const select = ['player_id', 'player_name', 'team_id', 'team_abbreviation', ...ranked(PLAYER_RANKED)].join(',');
    const query = { season: String(season), season_type: 'Regular Season', select, limit: PLAYER_LIMIT };
    return retrieveRowsFrom<RankRow>(leagueSource(league), 'player_stats_advanced', query, TTL, true, NBA_READ_TIMEOUT_MS);
}
