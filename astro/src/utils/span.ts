// Specs: q1..q4, ot (any period > 4), h1, h2, or "<from>-<to>" in game-clock
// seconds remaining (adj_TimeSecsRem: 3600 = Q1 15:00 counting down to 0).
// Clock ranges are normalized to 30-second buckets so crawlers cannot mint an
// unbounded set of cache keys, and apply to regulation only (the pipeline's
// adjusted clock collapses in OT).

export interface Span {
    key: string;
    label: string;
    test: (p: { period?: unknown; ['start.adj_TimeSecsRem']?: unknown }) => boolean;
}

const PERIOD_SPANS: Record<string, { label: string; periods?: number[]; ot?: boolean }> = {
    q1: { label: '1st quarter', periods: [1] },
    q2: { label: '2nd quarter', periods: [2] },
    q3: { label: '3rd quarter', periods: [3] },
    q4: { label: '4th quarter', periods: [4] },
    h1: { label: '1st half', periods: [1, 2] },
    h2: { label: '2nd half', periods: [3, 4] },
    ot: { label: 'Overtime', ot: true },
};

/** "3300" -> "Q1 10:00" -- where a game clock reading lives. */
export function fmtAdjClock(sec: number): string {
    const q = sec > 2700 ? 1 : sec > 1800 ? 2 : sec > 900 ? 3 : 4;
    let rem = sec - (4 - q) * 900;
    const mm = Math.floor(rem / 60), ss = rem % 60;
    return `Q${q} ${mm}:${String(ss).padStart(2, '0')}`;
}

export function parseSpan(raw: string | null | undefined): Span | null {
    if (!raw) return null;
    const key = raw.trim().toLowerCase();
    const named = PERIOD_SPANS[key];
    if (named) {
        return {
            key,
            label: named.label,
            test: (p) => {
                const n = p.period == null ? NaN : Number(p.period);
                return named.ot ? n > 4 : Number.isFinite(n) && (named.periods as number[]).includes(n);
            },
        };
    }
    const m = key.match(/^(\d{1,4})-(\d{1,4})$/);
    if (!m) return null;
    const bucket = (n: number) => Math.round(n / 30) * 30;
    const from = bucket(Math.min(Number(m[1]), 3600));
    const to = bucket(Math.max(Number(m[2]), 0));
    if (!(from > to)) return null; // the clock counts down: from must be the earlier moment
    return {
        key: `${from}-${to}`,
        label: `${fmtAdjClock(from)} → ${fmtAdjClock(to)}`,
        test: (p) => {
            const n = p['start.adj_TimeSecsRem'] == null ? NaN : Number(p['start.adj_TimeSecsRem']);
            const period = p.period == null ? NaN : Number(p.period);
            return Number.isFinite(n) && n <= from && n >= to && !(period > 4);
        },
    };
}