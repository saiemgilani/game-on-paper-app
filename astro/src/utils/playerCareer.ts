/**
 * The Career panel's pure step (BB-G54): his `player_war` and `player_impact` seasons as one table, one row per season.
 * Every value, rank, percentile and sample is the producer's (rule B6). The one number worked out here is the cohort a
 * rank is out of, from the producer's own percentile (cohortOf).
 */
import type { PlayerImpactRow } from '../resources/playerImpact';
import type { PlayerWarRow } from '../resources/playerWar';
import { numberOrNull } from './misc';

/** One cell: the value and, where the producer ranks it, its rank, percentile, cohort and sample (`_n`). */
export interface CareerCell { value: number | null; rank: number | null; pct: number | null; of: number | null; n: number | null }
export interface CareerColumn {
    key: string;
    label: string;
    hover: string;
    /** a ranked column's cells carry rank / pct / of / n, and the column gets a percentile trend */
    ranked: boolean;
    /** how the value prints: in wins / per 100 (signed) / a count */
    format: 'dec1' | 'signed1' | 'int';
}
export interface CareerRow { season: number; cells: Record<string, CareerCell> }
export interface CareerTable { columns: CareerColumn[]; rows: CareerRow[] }

type Spec = readonly [key: string, label: string, hover: string, ranked: boolean, format: CareerColumn['format']];
const WAR: readonly Spec[] = [
    ['poss', 'Poss', 'On-court possessions, offensive plus defensive over 2', false, 'int'],
    ['rating', 'Rating', 'Points per 100 possessions above a league-average player', false, 'signed1'],
    ['war', 'WAR', 'Wins above replacement', true, 'dec1'],
    ['vorp', 'VORP', 'Value over replacement player', true, 'dec1'],
];
const IMPACT: readonly Spec[] = [
    ['rapm', 'RAPM', 'Regularized adjusted plus-minus, per 100 possessions', true, 'signed1'],
    ['bpm', 'BPM', 'Box plus-minus, per 100 possessions', true, 'signed1'],
];

/**
 * The cohort a rank is out of. league_context (sdv-py) ranks among the season's n qualifiers and writes the Weibull
 * percentile 100 * (n + 1 - rank) / (n + 1), so n = 100 * rank / (100 - pct) - 1. Null when either is missing.
 * ponytail: inverted here because no basketball table ships the cohort count; read `league_averages.n` once one does.
 */
export function cohortOf(rank: number | null, pct: number | null): number | null {
    if (rank == null || pct == null || pct >= 100) return null;
    const n = Math.round((100 * rank) / (100 - pct) - 1);
    return n >= 1 ? n : null;
}

function cell(row: Record<string, unknown> | undefined, key: string, ranked: boolean): CareerCell {
    const value = numberOrNull(row?.[key]);
    if (!ranked) return { value, rank: null, pct: null, of: null, n: null };
    const rank = numberOrNull(row?.[`${key}_rank`]);
    const pct = numberOrNull(row?.[`${key}_pct`]);
    return { value, rank, pct, of: cohortOf(rank, pct), n: numberOrNull(row?.[`${key}_n`]) };
}

/** One row per season: a season with several rows (a college transfer's team rows) keeps the one with the most possessions. */
function bySeason<T extends Record<string, unknown>>(rows: readonly T[], size: (r: T) => number): Map<number, T> {
    const out = new Map<number, T>();
    for (const r of rows) {
        const s = numberOrNull(r.season);
        if (s == null) continue;
        const had = out.get(s);
        if (!had || size(r) > size(had)) out.set(s, r);
    }
    return out;
}

/**
 * His career table, oldest season first, or null when neither table has a row for him. `impact` is undefined for college
 * (no columns) and null when its read failed (the WAR columns still show; the panel says the impact ones are missing).
 */
export function careerTable(war: readonly PlayerWarRow[], impact: readonly PlayerImpactRow[] | null | undefined): CareerTable | null {
    const w = bySeason(war as unknown as Record<string, unknown>[], (r) => numberOrNull(r.poss) ?? 0);
    const i = bySeason(impact ?? [], (r) => (numberOrNull(r.off_poss) ?? 0) + (numberOrNull(r.def_poss) ?? 0));
    const seasons = [...new Set([...w.keys(), ...i.keys()])].sort((a, b) => a - b);
    if (seasons.length === 0) return null;
    const specs = impact !== undefined && impact !== null ? [...WAR, ...IMPACT] : WAR;
    const columns = specs.map(([key, label, hover, ranked, format]) => ({ key, label, hover, ranked, format }));
    const rows = seasons.map((season) => {
        const cells: Record<string, CareerCell> = {};
        for (const [key, , , ranked] of WAR) cells[key] = cell(w.get(season), key, ranked);
        if (specs !== WAR) for (const [key, , , ranked] of IMPACT) cells[key] = cell(i.get(season), key, ranked);
        return { season, cells };
    });
    return { columns, rows };
}

/** A whole-number percentile for the text: rounding may not print the 0th or 100th, which the producer never writes. */
export const pctLabel = (pct: number) => Math.min(99, Math.max(1, Math.round(pct)));

/**
 * The trend line for a ranked column: his percentile by season (the league's peers that season are its 0..100 scale, the
 * median at 50) in a `w` x `h` box: polylines through consecutive ranked seasons (a season he was not ranked in leaves a
 * gap) and a dot on every ranked season. Null under two ranked seasons.
 */
export function trendPoints(rows: readonly CareerRow[], key: string, w: number, h: number): { runs: string[]; dots: [number, number][] } | null {
    const n = rows.length;
    const x = (i: number) => Math.round(((i * w) / Math.max(1, n - 1)) * 10) / 10;
    const y = (p: number) => Math.round((h - (p / 100) * h) * 10) / 10;
    const runs: string[] = [];
    const dots: [number, number][] = [];
    let run: string[] = [];
    rows.forEach((r, idx) => {
        const p = r.cells[key]?.pct;
        if (p == null) { if (run.length > 1) runs.push(run.join(' ')); run = []; return; }
        dots.push([x(idx), y(p)]);
        run.push(`${x(idx)},${y(p)}`);
    });
    if (run.length > 1) runs.push(run.join(' '));
    return dots.length >= 2 ? { runs, dots } : null;
}
