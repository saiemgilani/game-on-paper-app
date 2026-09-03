// A time window over one game, parsed from ?span= on the game page. Applied
// once in GamePage frontmatter (game.plays is filtered before any derivation),
// so every astro-computed section -- play tables, drives, situational,
// defensive box, traditional stats, penalties -- recomputes for free. The
// python-computed advanced boxes stay full-game until the API grows the same
// parameter; the charts deliberately keep the whole game for context.
//
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
    q1: { label: 'Q1', periods: [1] },
    q2: { label: 'Q2', periods: [2] },
    q3: { label: 'Q3', periods: [3] },
    q4: { label: 'Q4', periods: [4] },
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

/** The pill row: Full + only the windows the game actually played. */
export function availableSpans(plays: { period?: unknown }[]): { key: string; label: string }[] {
    const periods = new Set(plays.map((p) => Number(p.period)).filter((n) => Number.isFinite(n) && n >= 1));
    const out: { key: string; label: string }[] = [];
    for (const key of ['q1', 'q2', 'h1', 'q3', 'q4', 'h2'] as const) {
        const def = PERIOD_SPANS[key];
        if ((def.periods as number[]).some((n) => periods.has(n))) out.push({ key, label: def.label });
    }
    if ([...periods].some((n) => n > 4)) out.push({ key: 'ot', label: 'Overtime' });
    return out;
}
