// BB-G34 (behind 'bball-player-box-views'): the player box's four views as column lists, and the cell shading against
// everyone who played in the game. Every count and rate is the producer's (the box, sdv-py's BB-D31 player splits, sdv-db
// player_season_stats); the arithmetic here is eFG%, the made/attempted shares and the per-minute expectation.
import type { NbaPlayerRow } from '../resources/nbaGame';
import type { PlayerSeasonRate } from '../resources/playerSeasonRates';
import { fmtDec, fmtPct } from '../nba/format';

export type PlayerBoxView = 'basic' | 'advanced' | 'shooting' | 'vsavg';
export const VIEW_LABEL: Record<PlayerBoxView, string> = { basic: 'Basic', advanced: 'Advanced', shooting: 'Shooting', vsavg: 'Vs average' };

/** One player as a view reads them: the box row and, for Vs average, their season line (absent: none, or a career line). */
export interface BoxCtx { p: NbaPlayerRow; avg?: PlayerSeasonRate }

export interface BoxCol {
    label: string
    /** the header's tooltip */
    title?: string
    text: (c: BoxCtx) => string
    /** the number the cell is shaded by; absent: never shaded (a made-attempted pair) */
    value?: (c: BoxCtx) => number | null
    better?: 'high' | 'low'
    /** the sample behind a rate, and the least that is shaded: a 1-for-1 is not the game's best shooter */
    n?: (c: BoxCtx) => number | null
    min?: number
}

const DASH = '–';
const show = (v: number | null | undefined, f: (x: number) => string) => (v == null || !Number.isFinite(v) ? DASH : f(v));
const int = (v: number | null | undefined) => show(v, (x) => String(Math.round(x)));
const pct = (v: number | null | undefined) => show(v, (x) => fmtPct(x, 1));
const dec = (v: number | null | undefined) => show(v, (x) => fmtDec(x, 1));
const signed = (v: number | null | undefined) => show(v, (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`);
const ratio = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b <= 0 ? null : a / b);

/** "6-12" -> [6, 12]; anything else (a missing pair) -> null. */
export function madeAttempted(s: string): [number, number] | null {
    const m = /^(\d+)-(\d+)$/.exec(s.trim());
    return m ? [Number(m[1]), Number(m[2])] : null;
}
const fga = (p: NbaPlayerRow) => madeAttempted(p.fg)?.[1] ?? null;
const tsa = (p: NbaPlayerRow) => { const f = madeAttempted(p.fg), t = madeAttempted(p.ft); return f && t ? f[1] + 0.44 * t[1] : null; };
export function efgPct(p: NbaPlayerRow): number | null {
    const f = madeAttempted(p.fg), t = madeAttempted(p.fg3);
    return f && t ? ratio(f[0] + 0.5 * t[0], f[1]) : null;
}
/** Points over the player's season points per minute times this game's minutes; null without both. */
export function expectedPoints(c: BoxCtx): number | null {
    const rate = ratio(c.avg?.pts, c.avg?.min);
    return rate == null || c.p.minutes == null ? null : rate * c.p.minutes;
}
const vsAvg = (c: BoxCtx) => { const e = expectedPoints(c); return e == null || c.p.points == null ? null : c.p.points - e; };
const pm = (p: NbaPlayerRow) => (p.plus_minus == null || !Number.isFinite(Number(p.plus_minus)) ? null : Number(p.plus_minus));

const MIN: BoxCol = { label: 'MIN', text: ({ p }) => int(p.minutes) };
// `better: null` leaves a count unshaded: a turnover count is lowest for whoever barely played, so it ranks minutes, not care
const count = (label: string, f: (p: NbaPlayerRow) => number | null, better: 'high' | null = 'high', title?: string): BoxCol =>
    ({ label, title, text: ({ p }) => int(f(p)), ...(better ? { value: ({ p }: BoxCtx) => f(p), better } : {}) });
const TS: BoxCol = { label: 'TS%', title: 'True shooting', text: ({ p }) => pct(p.ts_pct), value: ({ p }) => p.ts_pct, better: 'high', n: ({ p }) => tsa(p), min: 5 };
const USG: BoxCol = { label: 'USG%', title: 'Usage', text: ({ p }) => dec(p.usg_pct), value: ({ p }) => p.usg_pct, better: 'high' };
const PER_POSS = 10;
const per100 = (label: string, k: 'pts_per100' | 'ast_per100' | 'reb_per100' | 'tov_per100', better: 'high' | 'low' = 'high'): BoxCol =>
    ({ label, title: `${label.split('/')[0]} per 100 possessions (estimated)`, text: ({ p }) => dec(p.split?.[k]), value: ({ p }) => p.split?.[k] ?? null, better, n: ({ p }) => p.split?.est_possessions ?? null, min: PER_POSS });

/** The columns of one view. `pro`: the box has plus-minus (college boxes have none at the source); `split`: BB-D31's rows exist. */
export function viewColumns(view: PlayerBoxView, opts: { pro: boolean; split: boolean }): BoxCol[] {
    if (view === 'basic') return [
        MIN, count('PTS', (p) => p.points), count('REB', (p) => p.rebounds), count('AST', (p) => p.assists), count('STL', (p) => p.steals),
        count('BLK', (p) => p.blocks), count('TOV', (p) => p.turnovers, null),
        { label: 'FG', text: ({ p }) => p.fg }, { label: '3PT', text: ({ p }) => p.fg3 }, { label: 'FT', text: ({ p }) => p.ft }, TS, USG,
        ...(opts.pro ? [{ label: '+/-', text: ({ p }: BoxCtx) => p.plus_minus ?? DASH, value: ({ p }: BoxCtx) => pm(p), better: 'high' as const }] : []),
    ];
    if (view === 'advanced') return [
        MIN,
        ...(opts.split ? [{ label: 'Poss', title: 'Possessions, estimated: the team\'s counted possessions times the player\'s share of its minutes', text: ({ p }: BoxCtx) => dec(p.split?.est_possessions), value: ({ p }: BoxCtx) => p.split?.est_possessions ?? null, better: 'high' as const }] : []),
        TS, { label: 'eFG%', title: 'Effective field goal %', text: ({ p }) => pct(efgPct(p)), value: ({ p }) => efgPct(p), better: 'high', n: ({ p }) => fga(p), min: 4 }, USG,
        ...(opts.split ? [
            { label: 'Unast%', title: 'The share of the made field goals nobody assisted', text: ({ p }: BoxCtx) => pct(p.split?.assisted_share == null ? null : 1 - p.split.assisted_share), value: ({ p }: BoxCtx) => (p.split?.assisted_share == null ? null : 1 - p.split.assisted_share), better: 'high' as const, n: ({ p }: BoxCtx) => p.split?.fgm ?? null, min: 3 },
            per100('PTS/100', 'pts_per100'), per100('AST/100', 'ast_per100'), per100('REB/100', 'reb_per100'), per100('TOV/100', 'tov_per100', 'low'),
        ] : []),
    ];
    if (view === 'shooting') return [
        MIN,
        { label: 'Rim', title: 'Twos under 4 ft, made-attempted', text: ({ p }) => (p.split ? `${p.split.rim_fgm ?? 0}-${p.split.rim_fga ?? 0}` : DASH) },
        { label: 'Rim%', text: ({ p }) => pct(ratio(p.split?.rim_fgm, p.split?.rim_fga)), value: ({ p }) => ratio(p.split?.rim_fgm, p.split?.rim_fga), better: 'high', n: ({ p }) => p.split?.rim_fga ?? null, min: 3 },
        { label: 'Rim Ast%', title: 'The share of the made rim twos that were assisted', text: ({ p }) => pct(p.split?.rim_assisted_share) },
        { label: '3PT', title: 'Threes, made-attempted', text: ({ p }) => (p.split ? `${p.split.fg3m ?? 0}-${p.split.fg3a ?? 0}` : DASH) },
        { label: '3P%', text: ({ p }) => pct(ratio(p.split?.fg3m, p.split?.fg3a)), value: ({ p }) => ratio(p.split?.fg3m, p.split?.fg3a), better: 'high', n: ({ p }) => p.split?.fg3a ?? null, min: 3 },
        { label: '3PT Ast%', title: 'The share of the made threes that were assisted', text: ({ p }) => pct(p.split?.fg3_assisted_share) },
        { label: 'FG Ast%', title: 'The share of all made field goals that were assisted', text: ({ p }) => pct(p.split?.assisted_share) },
        count('TOV', (p) => p.split?.tov ?? null, null),
        count('Live TOV', (p) => p.split?.live_tov ?? null, null, 'Turnovers credited as a steal (a live ball the other way)'),
    ];
    return [
        MIN, count('PTS', (p) => p.points),
        { label: 'Exp', title: 'Expected points: the season\'s points per minute times this game\'s minutes', text: (c) => dec(expectedPoints(c)) },
        { label: 'Vs avg', title: 'Points over the expected points', text: (c) => signed(vsAvg(c)), value: vsAvg, better: 'high' },
        { label: 'Season PTS', title: 'Season points per game', text: ({ avg }) => dec(avg?.pts) },
        { label: 'Season MIN', title: 'Season minutes per game', text: ({ avg }) => dec(avg?.min) },
        { label: 'GP', title: 'Season games played', text: ({ avg }) => int(avg?.gp) },
    ];
}

/** The fewest qualified players a column is shaded over; fewer and no cell is. */
const MIN_POOL = 4;

/**
 * Each shaded cell's strength in (0, 1]: from the value's mid-rank percentile among everyone who played in the game and
 * qualifies for the column (its sample at least `min`), flipped where lower is better. Null: not shaded (the worse half,
 * an unqualified sample, or a column too few players qualify for).
 */
export function shader(col: BoxCol, pool: readonly BoxCtx[]): (c: BoxCtx) => number | null {
    if (!col.value || !col.better) return () => null;
    const ok = (c: BoxCtx) => (c.p.minutes ?? 0) > 0 && (col.n == null || (col.n(c) ?? 0) >= (col.min ?? 0));
    const vals = pool.filter(ok).map(col.value).filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length < MIN_POOL) return () => null;
    return (c) => {
        const v = ok(c) ? col.value!(c) : null;
        if (v == null || !Number.isFinite(v)) return null;
        const below = vals.filter((x) => x < v).length, same = vals.filter((x) => x === v).length;
        const q = (below + same / 2) / vals.length;
        // only the better half is tinted, from clear at the median to full at the best: a page of faint greens says nothing
        const s = Math.max(0, ((col.better === 'low' ? 1 - q : q) - 0.5) * 2);
        return s > 0 ? Math.round(s * 100) / 100 : null;
    };
}
