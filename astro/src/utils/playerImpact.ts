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
    /** NBA/WNBA: the possessions every measure is computed over */
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
 * College's panel waits for an ESPN↔NCAA player crosswalk (BB-D16; Akshay on #408): college RAPM is keyed by stats.ncaa.org
 * ids the ESPN-keyed page cannot reach, and box BPM alone is not the panel. Off: no read and no panel on /mbb and /wbb
 * player pages. Everything below still handles college, so re-enabling it is this one line.
 */
export const COLLEGE_IMPACT = false;
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
/** College: `player_value`'s box BPM. */
const COLLEGE: readonly Spec[] = [['BPM', 'Box plus-minus, per 100 possessions', 'box_obpm', 'box_dbpm', 'box_bpm']];

const cell = (row: PlayerImpactRow, col: string): ImpactCell => ({
    col,
    value: numberOrNull(row[col]),
    rank: numberOrNull(row[`${col}_rank`]),
    pct: numberOrNull(row[`${col}_pct`]),
});
const isTrue = (v: unknown) => v === true || v === 'true' || v === 'True' || v === 'TRUE';

/** The panel for the player's rows, or null when there is none. College: the team row with the most minutes. */
export function impactPanel(rows: PlayerImpactRow[], college: boolean): ImpactPanel | null {
    const row = [...rows].sort((a, b) => (numberOrNull(b.min) ?? 0) - (numberOrNull(a.min) ?? 0))[0];
    if (!row) return null;
    const measures = (college ? COLLEGE : PRO).map(([label, hover, off, def, net]) => ({
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
