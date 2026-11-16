/**
 * The Impact panel's pure step (BB-G6): pick the player's row and lay its columns out as the panel's measures. Nothing
 * here aggregates or ranks: each value, and each rank and percentile when the producer ships `<m>_rank` / `<m>_pct`, is
 * read as it is (rule B6).
 */
import type { PlayerImpactRow } from '../resources/playerImpact';
import { numberOrNull } from './misc';

/** One cell: the producer's value, and its rank and percentile when the row carries them. */
export interface ImpactCell { col: string; value: number | null; rank: number | null; pct: number | null }
/** One measure: offense, defense and net (a measure with one number fills `net` only). */
export interface ImpactMeasure { label: string; hover: string; off: ImpactCell | null; def: ImpactCell | null; net: ImpactCell }

export interface ImpactPanel {
    measures: ImpactMeasure[];
    /** some cell has a producer rank: the panel shows the rank columns and shades by percentile */
    ranked: boolean;
    /** the possessions the RAPM (and in the NBA/WNBA every measure) is computed over; null in college without RAPM */
    offPoss: number | null;
    defPoss: number | null;
    gp: number | null;
    min: number | null;
    /** college: player_value's minutes gate */
    qualified: boolean | null;
    /** NBA/WNBA: BOBAN's one-season-ahead projection, with its standard deviation */
    projection: { rating: number; sd: number | null } | null;
}

/**
 * College's panel (Akshay on #408: wait for the crosswalk) reads through `ncaa_player_crosswalk` (BB-D37): RAPM from
 * `ncaa_rapm` by his season's stats.ncaa.org id, box BPM from `player_value` by the page's ESPN id. A kill switch:
 * false hides it again (no read, no key, no panel on /mbb and /wbb player pages).
 */
export const COLLEGE_IMPACT = true;
/** Whether the player page reads and shows the panel for this league (pro always; college behind COLLEGE_IMPACT). */
export const impactShown = (college: boolean) => !college || COLLEGE_IMPACT;

type Spec = readonly [label: string, hover: string, off: string | null, def: string | null, net: string];

/**
 * The NBA/WNBA measures, from `player_impact`, every one with its offense / defense / net trio where the producer has it
 * (adjusted RAPM included, for consistency with RAPM: the producer centres o_adj_rapm / d_adj_rapm, so the page shows them
 * as read). BPM's O/D split carried the team's net rating in obpm until sdv-py #1114 traced it to nba_bpm's team adjust;
 * the player_impact republish carries the fix, and the page reads whatever the producer ships.
 */
const PRO: readonly Spec[] = [
    ['RAPM', 'Regularized adjusted plus-minus: the ridge on/off impact on team scoring, per 100 possessions', 'o_rapm', 'd_rapm', 'rapm'],
    ['Adj. RAPM', 'RAPM shrunk toward a box-score prior, per 100 possessions', 'o_adj_rapm', 'd_adj_rapm', 'adj_rapm'],
    ['SPM', 'Statistical plus-minus: box-score features fit to the season’s RAPM, per 100 possessions', 'ospm', 'dspm', 'spm'],
    ['BPM', 'Box plus-minus, per 100 possessions', 'obpm', 'dbpm', 'bpm'],
    ['BOBAN', 'Bayesian Online Box-Augmented Net: a Kalman-filtered estimate of current skill across his seasons, per 100 possessions', null, null, 'boban_filtered_skill'],
    ['WAR', 'Wins above replacement (replacement level −2.0 per 100 possessions), in wins', null, null, 'war'],
];
/**
 * College: `ncaa_rapm`'s league-wide RAPM (positive drapm is good defense; rapm_net = orapm + drapm) and `player_value`'s
 * box BPM. A player with no crosswalk pair has no RAPM columns, so his panel is BPM only.
 */
const COLLEGE: readonly Spec[] = [
    ['RAPM', 'Regularized adjusted plus-minus: the league-wide ridge on stats.ncaa.org lineups, per 100 possessions', 'orapm', 'drapm', 'rapm_net'],
    ['BPM', 'Box plus-minus, per 100 possessions', 'box_obpm', 'box_dbpm', 'box_bpm'],
];

const cell = (row: PlayerImpactRow, col: string): ImpactCell => ({
    col,
    value: numberOrNull(row[col]),
    rank: numberOrNull(row[`${col}_rank`]),
    pct: numberOrNull(row[`${col}_pct`]),
});
const isTrue = (v: unknown) => v === true || v === 'true' || v === 'True' || v === 'TRUE';

/** player_impact's WAR when the Value block shows player_war's too (BB-G27): its own name, so the two read apart. */
const IMPACT_WAR: Spec = ['Impact WAR', 'Wins above replacement from the impact ratings (replacement level −2.0 per 100 possessions), in wins, with no interval. A separate estimate from the Value WAR below, which carries its 90% interval', null, null, 'war'];

/**
 * The panel for the player's rows, or null when there is none. College: the team row with the most minutes. `relabelWar`
 * (BB-G27's 'bball-war' on) keeps player_impact's WAR under its own name, "Impact WAR": the Value block below shows
 * player_war's, with its interval, and the two are different estimates (sdv-db docs/api.md).
 */
export function impactPanel(rows: PlayerImpactRow[], college: boolean, relabelWar = false): ImpactPanel | null {
    const row = [...rows].sort((a, b) => (numberOrNull(b.min) ?? 0) - (numberOrNull(a.min) ?? 0))[0];
    if (!row) return null;
    const specs = college ? COLLEGE.filter(([, , , , net]) => row[net] !== undefined) : relabelWar ? PRO.map((s) => (s[4] === 'war' ? IMPACT_WAR : s)) : PRO;
    if (!specs.length) return null;
    const measures = specs.map(([label, hover, off, def, net]) => ({
        label, hover, off: off ? cell(row, off) : null, def: def ? cell(row, def) : null, net: cell(row, net),
    }));
    const rating = numberOrNull(row.boban_projected_rating);
    return {
        measures,
        ranked: measures.some((m) => [m.off, m.def, m.net].some((c) => c?.rank != null)),
        offPoss: numberOrNull(row.off_poss),
        defPoss: numberOrNull(row.def_poss),
        gp: numberOrNull(row.gp),
        min: numberOrNull(row.min),
        qualified: college && row.qualified != null ? isTrue(row.qualified) : null,
        projection: college || rating == null ? null : { rating, sd: numberOrNull(row.boban_projected_sd) },
    };
}
