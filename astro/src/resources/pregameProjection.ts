/**
 * The Data API read behind BB-G18 (behind 'bball-pregame-projection'): one season's team ratings in the league's season
 * schema. College reads `{mbb,wbb}.ratings` (adj_em, rank, keyed by ESPN team id); the pros read BB-D19's
 * `{nba,wnba}_stats.team_strength` (adj_net_rtg, its rank and pace, keyed by stats.nba.com / stats.wnba.com team id). One
 * season-filtered, capped read with a fixed select, so every game page of the league and the bracketology bracket share
 * one cache entry. Strict: an outage is never shown as a season with no ratings.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';
import type { TeamRating } from '../utils/pregameProjection';

/** The ratings are rebuilt once a day (the season products): the season pages' window. */
const TTL = 6 * 60 * 60;
/** college ratings carry every rated team (727 in 2025-26 men's), a pro season 30 or 15 */
const COLLEGE_LIMIT = '1000';
const PRO_LIMIT = '40';

interface CollegeRow { team_id: string | number; adj_em: number | null; rank: number | null; games: number | null }
interface ProRow { team_id: string | number; adj_net_rtg: number | null; adj_net_rtg_rank: number | null; games: number | null; pace: number | null }

/** One season's ratings by team id (ESPN for college, stats for the pros); empty before the season's first rated game. */
export async function retrieveSeasonRatings(league: BasketballLeague, season: number): Promise<Map<string, TeamRating>> {
    const src = leagueSource(league);
    const base = { season: String(season) };
    if (PRO_LEAGUES.includes(league)) {
        const rows = await retrieveRowsFrom<ProRow>(src, 'team_strength', { ...base, select: 'team_id,adj_net_rtg,adj_net_rtg_rank,games,pace', limit: PRO_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
        return new Map(rows.filter((r) => r.adj_net_rtg != null).map((r) => [String(r.team_id), { team_id: String(r.team_id), rating: r.adj_net_rtg!, rank: r.adj_net_rtg_rank, games: r.games, pace: r.pace }]));
    }
    const rows = await retrieveRowsFrom<CollegeRow>(src, 'ratings', { ...base, select: 'team_id,adj_em,rank,games', limit: COLLEGE_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
    return new Map(rows.filter((r) => r.adj_em != null).map((r) => [String(r.team_id), { team_id: String(r.team_id), rating: r.adj_em!, rank: r.rank, games: r.games, pace: null }]));
}
