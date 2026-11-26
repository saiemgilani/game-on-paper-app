/**
 * The depth ladder's pure step (BB-G61): the producer's tier rows, in the producer's order, each with its percentile band and
 * the team's players the producer put in it. Nothing is tiered, ranked or averaged here (rule B6): the tiers, the bands and
 * the medians are sdv-py's (`war_tiers`, `roster_tiers`, `roster_tier_shape`). A player with no tier (under the producer's
 * possession floor) stays off the ladder.
 */
import { tierOf, type LadderPlayerRow, type LadderScope, type TierShapeRow } from '../resources/depthLadder';

export interface LadderRung {
    tier: string;
    /** the producer's percentile band, as copy ("80 to under 95"); null when the row carries none */
    band: string | null;
    /** the scope's median players per team in this tier */
    median: number | null;
    /** the team's players in this tier, most WAR first (the read's order); `other`: most of his season elsewhere */
    players: { id: string; name: string; other: boolean }[];
}

/** `?tiers=` on a college team page: the Division I ladder (the default) or the conference's. */
export type TierView = 'd1' | 'conference';
export const TIER_VIEWS: readonly TierView[] = ['d1', 'conference'];
export const TIER_VIEW_LABEL: Record<TierView, string> = { d1: 'Division I tiers', conference: 'Conference tiers' };

export function parseTierView(raw: string | null): TierView {
    return raw === 'conference' ? 'conference' : 'd1';
}

export const scopeOf = (view: TierView): LadderScope => (view === 'conference' ? 'conference' : 'league');

export const DEPTH_LADDER_NOTE =
    "A player's tier is their WAR percentile among the league-season's players who were on the floor for at least a tenth of a team's possessions; a player under that floor is not placed. A player traded during the season is on every team they played for, with their full-season tier. The median is the median number of players per team in that tier.";
export const CONFERENCE_NOTE = 'Conference tiers rank each player among the players of their conference; the median is over the conference’s teams.';

const pct = (v: number) => String(Math.round(v));

/** The producer's band as copy: "95 and up", "80 to under 95", "under 20". */
export function bandOf(floor: number | null, ceiling: number | null): string | null {
    if (floor == null) return null;
    if (ceiling == null) return `${pct(floor)} and up`;
    return floor === 0 ? `under ${pct(ceiling)}` : `${pct(floor)} to under ${pct(ceiling)}`;
}

export function depthLadder(players: readonly LadderPlayerRow[], shape: readonly TierShapeRow[], scope: LadderScope = 'league'): LadderRung[] {
    const tier = tierOf(scope);
    return [...shape].sort((a, b) => a.tier_order - b.tier_order).map((s) => ({
        tier: s.war_tier,
        band: bandOf(s.pct_floor, s.pct_ceiling),
        median: s.players_median,
        players: players
            .filter((p) => p[tier] === s.war_tier)
            .map((p) => ({ id: String(p.player_id), name: p.player_name ?? `#${p.player_id}`, other: p.main_team === false })),
    }));
}
