/**
 * The Data API reads behind the team page's depth ladder (BB-G61, behind 'bball-depth-ladder'), both in the league's season
 * schema (`nba_stats` / `wnba_stats` keyed by the stats.nba.com / stats.wnba.com ids, `mbb` / `wbb` by ESPN's):
 * - `roster_tiers`: every player the team used, a traded player on each team he played for, with his full-season tiers
 *   (sportsdataverse-py BB-G61 `war_tiers`: Star, Starter, Rotation, Bench, Fringe by WAR percentile among the league-season's
 *   players over a possession floor, null under it; college adds `war_tier_conf`, the same ladder within the conference);
 * - `roster_tier_shape`: the median roster on that ladder, one row per tier, league-wide (`scope=league`) or, in college, for
 *   the team's conference (`scope=conference`), with the tier's percentile band.
 * Every tier, band and median is the producer's (rule B6). Reads are strict and bounded by the game page's read timeout.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** A college or pro roster's rows (a pro team uses 20-odd players a season); the cap keeps a bad filter from paging. */
const TEAM_LIMIT = '60';

/** `league`: every team (Division I in college); `conference`: the team's conference (college only). */
export type LadderScope = 'league' | 'conference';

/** One `roster_tiers` row. */
export interface LadderPlayerRow {
    player_id: number | string;
    player_name: string | null;
    /** false: he played most of his season for another team */
    main_team: boolean | null;
    war: number | null;
    war_tier: string | null;
    war_tier_conf?: string | null;
    conference_id?: number | string | null;
}

/** One `roster_tier_shape` row. */
export interface TierShapeRow {
    scope: LadderScope;
    conference_id: number | string | null;
    war_tier: string;
    /** 1 = Star */
    tier_order: number;
    /** the tier's band of the tier-cohort WAR percentile: floor inclusive, ceiling exclusive, no ceiling for the top tier */
    pct_floor: number | null;
    pct_ceiling: number | null;
    /** the median over the scope's teams of the players in this tier (a team with nobody in it counts 0) */
    players_median: number | null;
    players_mean: number | null;
    teams: number | null;
}

export interface DepthLadderReads {
    scope: LadderScope;
    players: LadderPlayerRow[];
    shape: TierShapeRow[];
}

/**
 * - `DepthLadderReads`: the ladder;
 * - `'none'`: a team-season with no rows (a season the producer does not cover), or a conference view for a team with no
 *   conference: nothing to show, cacheable;
 * - `'pending'`: rows without a tier, or a read that answered 404 or 5xx (the API before the producer's reload answers 500
 *   for a table the warehouse does not have yet): no section, and the page is not cached so it shows up once loaded.
 */
export type DepthLadderResult = DepthLadderReads | 'none' | 'pending';

const read = <T>(league: BasketballLeague, table: string, query: Record<string, string>) =>
    retrieveRowsFrom<T>(leagueSource(league), table, query, TTL, true, NBA_READ_TIMEOUT_MS);

const notYet = (e: any) => e?.status === 404 || (typeof e?.status === 'number' && e.status >= 500);

/** The tier column a scope reads. */
export const tierOf = (scope: LadderScope) => (scope === 'conference' ? 'war_tier_conf' : 'war_tier');

/** The team's rows, most WAR first, and the scope's tier shape. A failure that is not "not loaded yet" throws (the section's "unavailable"). */
export async function retrieveDepthLadder(league: BasketballLeague, season: number, teamId: number, scope: LadderScope = 'league'): Promise<DepthLadderResult> {
    const s = String(season);
    const shapeQuery = (extra: Record<string, string>) => read<TierShapeRow>(league, 'roster_tier_shape', { season: s, scope, ...extra, order: 'tier_order', limit: '10' });
    const playersP = read<LadderPlayerRow>(league, 'roster_tiers', { season: s, team_id: String(teamId), order: '-war', limit: TEAM_LIMIT });
    // league-wide the shape needs nothing from the rows, so both reads start together
    const leagueShapeP = scope === 'league' ? shapeQuery({}) : undefined;
    leagueShapeP?.catch(() => {}); // settled below; this only keeps an early return from leaving an unhandled rejection
    let players: LadderPlayerRow[];
    try {
        players = await playersP;
    } catch (e: any) {
        if (notYet(e)) return 'pending';
        throw e;
    }
    if (players.length === 0) return 'none';
    const tier = tierOf(scope);
    if (!players.some((r) => r[tier] != null)) return 'pending';
    let shapeP = leagueShapeP;
    if (!shapeP) {
        const conf = players.find((r) => r.conference_id != null)?.conference_id;
        if (conf == null) return 'none';
        shapeP = shapeQuery({ conference_id: String(conf) });
    }
    let shape: TierShapeRow[];
    try {
        shape = await shapeP;
    } catch (e: any) {
        if (notYet(e)) return 'pending';
        throw e;
    }
    return shape.length ? { scope, players, shape } : 'pending';
}
