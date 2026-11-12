/**
 * The Season vs Current panel's pure step (BB-G56): his `player_impact` row's season rating (BB-D38) and his latest
 * `current_impact` row (BB-D39) as the panel's rows. Nothing is computed: each value is the producer's (rule B6), and
 * neither table ships an interval, so the panel shows none.
 */
import type { CurrentImpactRow } from '../resources/currentImpact';
import type { PlayerImpactRow } from '../resources/playerImpact';
import { numberOrNull } from './misc';

export interface Trio { off: number | null; def: number | null; net: number | null }
export interface CurrentImpactPanel {
    /** the season rating and the box prior it shrinks toward; null when the season row has no rating yet */
    season: { rating: Trio; prior: Trio } | null;
    /** the latest rating and its prior (the producer ships no net prior); null before the season's first build */
    current: { rating: Trio; prior: Trio; asOf: string; lastGame: string | null; offPoss: number | null; defPoss: number | null; early: boolean } | null;
}

/**
 * Under this many possessions a side this season, the current rating is mostly its prior: 0 on opening night, about two
 * weeks of a starter's games. ponytail: one cut for both sides; a weight from the producer would replace it if one ships.
 */
export const EARLY_POSS = 1000;

const trio = (o: unknown, d: unknown, n: unknown): Trio => ({ off: numberOrNull(o), def: numberOrNull(d), net: numberOrNull(n) });
const empty = (t: Trio) => t.off == null && t.def == null && t.net == null;

/** The panel, or null when neither rating exists for him (an unbuilt season, or he did not play). */
export function currentImpactPanel(seasonRows: readonly PlayerImpactRow[], currentRows: readonly CurrentImpactRow[]): CurrentImpactPanel | null {
    const s = seasonRows[0];
    const c = currentRows[0];
    const rating = s ? trio(s.o_reml_rapm, s.d_reml_rapm, s.reml_rapm) : null;
    const season = s && rating && !empty(rating) ? { rating, prior: trio(s.o_box_prior, s.d_box_prior, s.box_prior) } : null;
    const now = c ? trio(c.o_current_impact, c.d_current_impact, c.current_impact) : null;
    const offPoss = c ? numberOrNull(c.off_poss) : null;
    const defPoss = c ? numberOrNull(c.def_poss) : null;
    const current = c && now && !empty(now) ? {
        rating: now,
        prior: trio(c.o_prior, c.d_prior, null),
        asOf: c.as_of,
        lastGame: c.last_game_date ?? null,
        offPoss, defPoss,
        // a missing count is unknown, not zero: only a count the producer shipped can say "early"
        early: [offPoss, defPoss].some((p) => p != null && p < EARLY_POSS),
    } : null;
    return season || current ? { season, current } : null;
}
