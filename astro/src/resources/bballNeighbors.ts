/**
 * The Data API read behind the basketball nearby-rank lists (BB-G12, behind 'bball-rank-neighbors'), football's S3
 * (`rank-neighbors`) on the basketball team pages. One season-wide read, the same URL for every team page of a season, so
 * one cache entry: `team_strength` (`nba_stats` / `wnba_stats` keyed by the stats team id; `mbb` / `wbb` by ESPN's),
 * whose `<m>_rank` columns are sdv-py's (1 = best). Player lists wait for a producer-ranked player table with a minutes
 * minimum (a roadmap follow-up), so the player pages have none. Ranks are never recomputed here. Reads are strict and bounded by the game page's read timeout, so an outage or a stalled
 * request is the section's "unavailable" line, never an empty list or a held page.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** D-I is about 365 teams. The cap keeps a bad filter from paging silently. */
const TEAM_LIMIT = '400';

/** The team lists, in the team page's season-block order. */
export const TEAM_RANKED = ['net_rtg', 'off_rtg', 'def_rtg', 'adj_net_rtg', 'efg_pct', 'opp_efg_pct', 'pace', 'tov_pct', 'orb_pct', 'ft_rate', 'sos', 'sov'] as const;

export type RankRow = Record<string, unknown>;

const ranked = (cols: readonly string[]) => cols.flatMap((c) => [c, `${c}_rank`]);

export function retrieveTeamRankRows(league: BasketballLeague, season: number): Promise<RankRow[]> {
    const select = ['team_id', ...ranked(TEAM_RANKED)].join(',');
    return retrieveRowsFrom<RankRow>(leagueSource(league), 'team_strength', { season: String(season), select, limit: TEAM_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
}
