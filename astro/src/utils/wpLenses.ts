/**
 * BB-G45, behind 'bball-wp-lenses': the WP chart's lenses, its margin overlay and the game-flow extras under it. Pure steps on
 * the plays the page already has, plus the two per-play variants sdv-db serves on `{lg}.play_wp` (sdv-db #217, sdv-py
 * `nba_game_lines.wp_variants`): `home_win_prob_naive` (the same model with a 0.5 prior: score, clock and possession only) and
 * `home_win_prob_market` (the prior from the game's no-vig closing line; null with no line). Our `home_win_prob` stays the
 * default lens; a variant that is not there for every charted play is no lens at all.
 */
import type { NbaGame, NbaPlay } from '../resources/nbaGame';
import { clockSeconds, fmtClock, gameSeconds, leadSeries, periodStart, runs, type FlowPoint, type Run } from './gameFlow';
import { periodShort } from '../basketball/periods';
import type { PeriodKind } from '../basketball/config';
import { biggestPlays } from '../nba/data/game';

/** One play's variants, keyed by `game_play_number` (resources/wpLenses.ts). */
export interface WpLensRow { n: number; naive: number | null; market: number | null }

export type LensKey = 'model' | 'naive' | 'market';
/** A lens the chart can switch to: home WP per charted play, in chart order. */
export interface Lens { key: LensKey; label: string; values: number[] }
/** One charted play for the margin overlay and the readout: its period and clock, and the score after it. */
export interface Moment { at: string; a: number; h: number }

export const LENS_LABELS: Record<LensKey, string> = { model: 'Our model', naive: 'Score and clock only', market: 'Market prior' };
export const LENS_NOTES: Record<LensKey, string> = {
    model: 'our model starts from the pregame prior',
    naive: 'score and clock only starts every game at 50%',
    market: "market prior starts from the closing line's no-vig win probability",
};
/** The scoring runs the extras list: 8-0 or better. */
export const RUN_LIST_MIN = 8;
/** The "last 5:00" window, in game-clock seconds. */
const LAST_WINDOW = 5 * 60;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The plays the WP chart draws (nba/data/game.ts wpChartPlays: every play with a home WP), in order. */
export const chartPlays = (game: NbaGame): NbaPlay[] => game.plays.filter((p) => p.homeWinProb != null);

/** Our model, then each variant present on every charted play. A single lens is no switch: null. */
export function wpLenses(plays: readonly NbaPlay[], rows: readonly WpLensRow[] | undefined): Lens[] | null {
    if (!rows?.length || plays.length === 0) return null;
    const byN = new Map(rows.map((r) => [r.n, r]));
    const out: Lens[] = [{ key: 'model', label: LENS_LABELS.model, values: plays.map((p) => p.homeWinProb!) }];
    for (const key of ['naive', 'market'] as const) {
        const values = plays.map((p) => byN.get(p.n)?.[key]);
        if (values.every(finite)) out.push({ key, label: LENS_LABELS[key], values });
    }
    return out.length > 1 ? out : null;
}

/** "Q3 4:12": a play's period and clock. */
export const stampOf = (p: Pick<NbaPlay, 'period' | 'clock'>, regulation: number, kind: PeriodKind) => `${periodShort(p.period, regulation, kind)} ${p.clock}`.trim();

export const moments = (plays: readonly NbaPlay[], regulation: number, kind: PeriodKind): Moment[] =>
    plays.map((p) => ({ at: stampOf(p, regulation, kind), a: p.awayScore, h: p.homeScore }));

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signedPts = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}`;

/** The hover / pin readout: "Q3 4:12 · CHA 70-66 PHI · PHI 61.2%". `wp` is the home side's, on the lens shown. */
export function momentText(m: Moment, wp: number, home: string, away: string): string {
    const lead = wp >= 0.5 ? `${home} ${pct(wp)}` : `${away} ${pct(1 - wp)}`;
    return `${m.at} · ${away} ${m.a}-${m.h} ${home} · ${lead}`;
}

/** The drag readout over a stretch, in play order: the home WP's change and who outscored whom. */
export function stretchText(from: Moment, to: Moment, wpFrom: number, wpTo: number, home: string, away: string): string {
    const dh = to.h - from.h, da = to.a - from.a;
    const scored = dh === da ? `${away} ${da}, ${home} ${dh}` : dh > da ? `${home} outscored ${away} ${dh}-${da}` : `${away} outscored ${home} ${da}-${dh}`;
    return `${from.at} to ${to.at}: ${home} ${pct(wpFrom)} to ${pct(wpTo)} (${signedPts(wpTo - wpFrom)} pts); ${scored}`;
}

/** Game-clock seconds elapsed at a play; null when its clock does not parse. */
export function playTime(p: Pick<NbaPlay, 'period' | 'clock'>, regulation: number, periodSeconds: number): number | null {
    const left = clockSeconds(p.clock);
    if (left == null) return null;
    const len = p.period > regulation ? 5 * 60 : periodSeconds;
    return periodStart(p.period, regulation, periodSeconds) + Math.max(0, len - left);
}

/** Game-clock seconds back to "Q2 4:50": the period it ends (a score at the buzzer is the period's 0:00, not the next's start). */
export function stampAt(t: number, periods: number, regulation: number, periodSeconds: number, kind: PeriodKind): string {
    let p = 1;
    while (p < Math.max(periods, regulation) && t > periodStart(p + 1, regulation, periodSeconds)) p++;
    return `${periodShort(p, regulation, kind)} ${fmtClock(Math.max(0, periodStart(p + 1, regulation, periodSeconds) - t))}`;
}

export interface Drought { side: 'home' | 'away'; seconds: number; from: number; to: number }
export interface Peak { wp: number; play: NbaPlay }
export interface FlowExtras {
    runs: Run[];
    /** the longer of the two sides' longest gaps between two of their own scores; null before either scored twice */
    drought: Drought | null;
    /** Q40, the clutch clock: points each side scored in the last 5:00 of regulation plus every overtime (the producer's
     * clutch split's window, #416); finals only */
    last5: { home: number; away: number } | null;
    /** each side's highest WP before the game was over (the settled 1 / 0 rows are not a peak) */
    peak: { home: Peak | null; away: Peak | null };
    /** the play that moved the home WP the most (nba/data/game.ts biggestPlays' first) */
    swing: NbaPlay | null;
    /** the eventual winner's lowest WP before the game was over, from this page's WP series; finals with a winner only */
    comeback: (Peak & { side: 'home' | 'away' }) | null;
}

/** The longest gap of game clock between two of one side's scores, from the score-change series. */
function longestDrought(series: readonly FlowPoint[]): Drought | null {
    let best: Drought | null = null;
    for (const side of ['home', 'away'] as const) {
        let last: number | null = null;
        for (let i = 1; i < series.length; i++) {
            if (series[i][side] <= series[i - 1][side]) continue;
            const t = series[i].t;
            if (last != null && (best == null || t - last > best.seconds)) best = { side, seconds: t - last, from: last, to: t };
            last = t;
        }
    }
    return best;
}

const withSide = (p: Peak | null, side: 'home' | 'away') => (p == null ? null : { ...p, side });

export function flowExtras(game: NbaGame, periodSeconds: number): FlowExtras {
    const reg = game.regulation;
    const total = gameSeconds(game.periods, reg, periodSeconds);
    const series = leadSeries(game.plays, reg, periodSeconds);
    // a play at the game's last tick is the settled row (1 / 0): not a peak, not a low
    const live = chartPlays(game).filter((p) => { const t = playTime(p, reg, periodSeconds); return t != null && t < total; });
    const extreme = (wp: (p: NbaPlay) => number, better: (a: number, b: number) => boolean): Peak | null =>
        live.reduce<Peak | null>((best, p) => (best == null || better(wp(p), best.wp) ? { wp: wp(p), play: p } : best), null);
    const homeWp = (p: NbaPlay) => p.homeWinProb!;
    const awayWp = (p: NbaPlay) => 1 - p.homeWinProb!;
    const done = game.status.completed;
    const winner = !done ? null : game.home.winner ? 'home' : game.away.winner ? 'away' : null;
    let last5: FlowExtras['last5'] = null;
    if (done && series.length > 1) {
        // the last 5:00 of regulation, then every overtime to the end
        const cut = gameSeconds(reg, reg, periodSeconds) - LAST_WINDOW;
        const before = [...series].reverse().find((p) => p.t < cut) ?? series[0];
        const end = series[series.length - 1];
        last5 = { home: end.home - before.home, away: end.away - before.away };
    }
    return {
        runs: runs(series, RUN_LIST_MIN),
        drought: longestDrought(series),
        last5,
        peak: { home: extreme(homeWp, (a, b) => a > b), away: extreme(awayWp, (a, b) => a > b) },
        swing: biggestPlays(game.plays, 1)[0] ?? null,
        comeback: winner == null ? null : withSide(extreme(winner === 'home' ? homeWp : awayWp, (a, b) => a < b), winner),
    };
}
