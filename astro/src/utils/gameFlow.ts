/**
 * The game page Game flow panel's pure steps (BB-G28): the lead chart's series from the play-by-play the page already
 * has, its lead changes and its 10-0 runs. The panel's totals are the producer's (sdv-db game_flow, sdv-py
 * `_common.game_flow`); these steps only draw, and use the producer's definitions so the marks agree with its row
 * (a tie is not a lead and the first lead is not a change; a run is points with the opponent scoring none).
 */
import type { NbaPlay } from '../resources/nbaGame';

type ScorePlay = Pick<NbaPlay, 'period' | 'clock' | 'homeScore' | 'awayScore'>;

/** Overtime is five minutes in every basketball league GOP covers. */
const OT_SECONDS = 5 * 60;
/** A run the chart marks: the producer's `runs_10` threshold. */
export const RUN_MIN = 10;

/** "5:32" or "45.2" (under a minute) as seconds left in the period; null for anything else. */
export function clockSeconds(clock: string): number | null {
    const m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(clock.trim());
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    const s = /^\d+(?:\.\d+)?$/.test(clock.trim()) ? Number(clock) : NaN;
    return Number.isFinite(s) ? s : null;
}

/** Game-clock seconds elapsed at the start of `period` (1-based), regulation periods first, then the overtimes. */
export function periodStart(period: number, regulation: number, periodSeconds: number): number {
    const p = Math.max(1, period);
    return p <= regulation ? (p - 1) * periodSeconds : regulation * periodSeconds + (p - regulation - 1) * OT_SECONDS;
}

/** Game-clock length: regulation plus the overtimes played. */
export function gameSeconds(periods: number, regulation: number, periodSeconds: number): number {
    return periodStart(Math.max(periods, regulation) + 1, regulation, periodSeconds);
}

export interface FlowPoint {
    /** game-clock seconds elapsed */
    t: number;
    /** home score minus away score after the play */
    margin: number;
    home: number;
    away: number;
}

/**
 * The margin over game time: one point per score change (the 0-0 tip first). A play whose clock does not parse keeps the
 * last time, so the line never runs backwards.
 */
export function leadSeries(plays: readonly ScorePlay[], regulation: number, periodSeconds: number): FlowPoint[] {
    const out: FlowPoint[] = [{ t: 0, margin: 0, home: 0, away: 0 }];
    for (const p of plays) {
        const last = out[out.length - 1];
        if (p.homeScore === last.home && p.awayScore === last.away) continue;
        const left = clockSeconds(p.clock);
        const len = p.period > regulation ? OT_SECONDS : periodSeconds;
        const t = left == null ? last.t : Math.max(last.t, periodStart(p.period, regulation, periodSeconds) + Math.max(0, len - left));
        out.push({ t, margin: p.homeScore - p.awayScore, home: p.homeScore, away: p.awayScore });
    }
    return out;
}

/** The points where the leader flipped (a tie is not a lead; the first lead is not a change). */
export function leadChanges(series: readonly FlowPoint[]): FlowPoint[] {
    let leader = 0;
    const out: FlowPoint[] = [];
    for (const p of series) {
        const s = Math.sign(p.margin);
        if (s === 0) continue;
        if (leader !== 0 && s !== leader) out.push(p);
        leader = s;
    }
    return out;
}

export interface Run {
    side: 'home' | 'away';
    points: number;
    /** game-clock seconds at the run's first and last score */
    from: number;
    to: number;
    /** the score (away-home) when the run ended */
    away: number;
    home: number;
}

/**
 * Unanswered runs of at least `min` points. A run ends when the other side scores; a score change that lowers a side
 * (a correction) comes off that side's running total, as in the producer.
 */
export function runs(series: readonly FlowPoint[], min = RUN_MIN): Run[] {
    const out: Run[] = [];
    let cur = null as Run | null; // a cast, not an annotation: close() reassigns it, which narrowing cannot see
    const close = () => { if (cur && cur.points >= min) out.push(cur); cur = null; };
    for (let i = 1; i < series.length; i++) {
        const a = series[i - 1], b = series[i];
        const dh = b.home - a.home, da = b.away - a.away;
        if (dh > 0 && da > 0) { close(); continue; } // both moved in one row: nobody's run
        const side = dh > 0 ? 'home' : da > 0 ? 'away' : null;
        if (side === null) { // a correction: off the run of the side it lowers
            if (cur && ((cur.side === 'home' && dh < 0) || (cur.side === 'away' && da < 0))) cur.points += cur.side === 'home' ? dh : da;
            continue;
        }
        const pts = side === 'home' ? dh : da;
        if (cur?.side === side) { cur.points += pts; cur.to = b.t; cur.home = b.home; cur.away = b.away; } else { close(); cur = { side, points: pts, from: b.t, to: b.t, home: b.home, away: b.away }; }
    }
    close();
    return out;
}

/** "4:08" for 248 seconds: the drought and time-leading cells. */
export function fmtClock(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds)) return '—';
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
