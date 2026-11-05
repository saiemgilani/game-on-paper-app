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

type Spec = readonly [label: string, hover: string, off: string | null, def: string | null, net: string];

/**
 * The NBA/WNBA measures, from `player_impact`. Adjusted RAPM shows its net number only: the producer's o_adj_rapm and
 * d_adj_rapm carry an offset of about +11 / -11 per 100 (their sum, adj_rapm, is right), so the split would mislead.
 */
const PRO: readonly Spec[] = [
    ['RAPM', 'Regularized adjusted plus-minus: the ridge on/off impact on team scoring, per 100 possessions', 'o_rapm', 'd_rapm', 'rapm'],
    ['Adj. RAPM', 'RAPM shrunk toward a box-score prior, per 100 possessions (net only)', null, null, 'adj_rapm'],
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
