/**
 * The Data API reads behind the team page's depth ladder (BB-G61, behind 'bball-depth-ladder'), both in the league's season
 * schema (`nba_stats` / `wnba_stats` keyed by the stats.nba.com / stats.wnba.com ids, `mbb` / `wbb` by ESPN's):
 * - `player_war`: the team's players, a player on the team he played most possessions for, each with the producer's
 *   `war_tier` (sportsdataverse-py BB-G61: Star, Starter, Rotation, Bench, Fringe by `war_pct` within the league-season);
 * - `roster_tier_shape`: the league's median roster on that ladder, one row per tier.
 * Every tier and median is the producer's (rule B6). Reads are strict and bounded by the game page's read timeout.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** A college or pro roster's player_war rows (a pro team uses 20-odd players a season); the cap keeps a bad filter from paging. */
const TEAM_LIMIT = '60';

/** One `player_war` row as the ladder reads it (every column is read: before the season-products reload there is no war_tier). */
export interface LadderPlayerRow {
    player_id: number | string;
    player_name: string | null;
    war: number | null;
    war_tier?: string | null;
}

/** One `roster_tier_shape` row. */
export interface TierShapeRow {
    war_tier: string;
    /** 1 = Star */
    tier_order: number;
    /** the median over the league's teams of the players in this tier (a team with nobody in it counts 0) */
    players_median: number | null;
    players_mean: number | null;
    teams: number | null;
}

export interface DepthLadderReads {
    players: LadderPlayerRow[];
    shape: TierShapeRow[];
}

const read = <T>(league: BasketballLeague, table: string, query: Record<string, string>) =>
    retrieveRowsFrom<T>(leagueSource(league), table, query, TTL, true, NBA_READ_TIMEOUT_MS);

/**
 * The team's player_war rows, most WAR first, and the league's tier shape. `undefined` when the season has no ladder yet:
 * no row carries a `war_tier` (the table before the producer's reload) or the shape table is not built (a 404). Any
 * other failure throws, so the caller can show the section as unavailable.
 */
export async function retrieveDepthLadder(league: BasketballLeague, season: number, teamId: number): Promise<DepthLadderReads | undefined> {
    const s = String(season);
    const [players, shape] = await Promise.allSettled([
        read<LadderPlayerRow>(league, 'player_war', { season: s, team_id: String(teamId), order: '-war', limit: TEAM_LIMIT }),
        read<TierShapeRow>(league, 'roster_tier_shape', { season: s, order: 'tier_order', limit: '10' }),
    ]);
    if (players.status === 'rejected') throw players.reason;
    if (!players.value.some((r) => 'war_tier' in r)) return undefined;
    if (shape.status === 'rejected') {
        if (shape.reason?.status === 404) return undefined;
        throw shape.reason;
    }
    return shape.value.length ? { players: players.value, shape: shape.value } : undefined;
}
