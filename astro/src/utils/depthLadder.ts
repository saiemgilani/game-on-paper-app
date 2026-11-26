/**
 * The depth ladder's pure step (BB-G61): the producer's tier rows, in the producer's order, each with the team's players the
 * producer put in it. Nothing is tiered, ranked or averaged here (rule B6): `war_tier` and the league median are sdv-py's.
 * A player with no `war_tier` (no WAR percentile: under the producer's ten-player cohort) stays off the ladder.
 */
import type { LadderPlayerRow, TierShapeRow } from '../resources/depthLadder';

export interface LadderRung {
    tier: string;
    /** the tier's share of the league-season, as copy */
    band: string | null;
    /** the league's median players per team in this tier */
    median: number | null;
    /** the team's players in this tier, most WAR first (the read's order) */
    players: { id: string; name: string }[];
}

/** The producer's cut points (sportsdataverse-py WAR_TIERS) as the page's copy, keyed by its tier names. */
export const TIER_BANDS: Readonly<Record<string, string>> = {
    Star: 'Top 5%',
    Starter: '5–20%',
    Rotation: '20–50%',
    Bench: '50–80%',
    Fringe: 'Bottom 20%',
};

export const DEPTH_LADDER_NOTE =
    "A player's tier is their WAR percentile band among every player of the league-season. The league median is the median number of players per team in that tier; a player counts for the team they played the most possessions for.";

export function depthLadder(players: readonly LadderPlayerRow[], shape: readonly TierShapeRow[]): LadderRung[] {
    return [...shape].sort((a, b) => a.tier_order - b.tier_order).map((s) => ({
        tier: s.war_tier,
        band: TIER_BANDS[s.war_tier] ?? null,
        median: s.players_median,
        players: players.filter((p) => p.war_tier === s.war_tier).map((p) => ({ id: String(p.player_id), name: p.player_name ?? `#${p.player_id}` })),
    }));
}
