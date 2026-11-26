/**
 * The Data API reads behind the team page's depth ladder (BB-G61, behind 'bball-depth-ladder'), both in the league's season
 * schema (`nba_stats` / `wnba_stats` keyed by the stats.nba.com / stats.wnba.com ids, `mbb` / `wbb` by ESPN's):
 * - `player_war`: the team's players, a player on the team he played most possessions for, each with the producer's
 *   `war_tier` (sportsdataverse-py BB-G61 `war_tiers`: Star, Starter, Rotation, Bench, Fringe by WAR percentile among the
 *   league-season's players over a possession floor; null under it);
 * - `roster_tier_shape`: the league's median roster on that ladder, one row per tier, with the tier's percentile band.
 * Every tier, band and median is the producer's (rule B6). Reads are strict and bounded by the game page's read timeout.
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
    /** the tier's band of the tier-cohort WAR percentile: floor inclusive, ceiling exclusive, no ceiling for the top tier */
    pct_floor: number | null;
    pct_ceiling: number | null;
    /** the median over the league's teams of the players in this tier (a team with nobody in it counts 0) */
    players_median: number | null;
    players_mean: number | null;
    teams: number | null;
}

export interface DepthLadderReads {
    players: LadderPlayerRow[];
    shape: TierShapeRow[];
}

/**
 * - `DepthLadderReads`: the ladder;
 * - `'none'`: a team-season with no player_war rows (a season the producer does not cover): nothing to show, cacheable;
 * - `'pending'`: rows without a tier, or a shape read that answered 404 or 5xx (the API before the producer's reload answers
 *   500 for a table the warehouse does not have yet): no section, and the page is not cached so it shows up once loaded.
 */
export type DepthLadderResult = DepthLadderReads | 'none' | 'pending';

const read = <T>(league: BasketballLeague, table: string, query: Record<string, string>) =>
    retrieveRowsFrom<T>(leagueSource(league), table, query, TTL, true, NBA_READ_TIMEOUT_MS);

const notYet = (e: any) => e?.status === 404 || (typeof e?.status === 'number' && e.status >= 500);

/** The team's player_war rows, most WAR first, and the league's tier shape. A player_war failure throws (the section's "unavailable"). */
export async function retrieveDepthLadder(league: BasketballLeague, season: number, teamId: number): Promise<DepthLadderResult> {
    const s = String(season);
    const [players, shape] = await Promise.allSettled([
        read<LadderPlayerRow>(league, 'player_war', { season: s, team_id: String(teamId), order: '-war', limit: TEAM_LIMIT }),
        read<TierShapeRow>(league, 'roster_tier_shape', { season: s, order: 'tier_order', limit: '10' }),
    ]);
    if (players.status === 'rejected') throw players.reason;
    if (players.value.length === 0) return 'none';
    if (!players.value.some((r) => r.war_tier != null)) return 'pending';
    if (shape.status === 'rejected') {
        if (notYet(shape.reason)) return 'pending';
        throw shape.reason;
    }
    return shape.value.length ? { players: players.value, shape: shape.value } : 'pending';
}
