/**
 * How far behind ESPN is what a visitor actually sees, and which layer is
 * responsible. Pure module -- no astro:* or cloudflare imports -- so vitest
 * can run it.
 *
 * Layers between ESPN and a browser:
 *   ESPN scoreboard -> KV "scoreboard" (TTL 2x refresh, age from metadata)
 *                   -> edge cache of "/"           (maxAge + swr)
 *   ESPN pbp        -> KV gamestate high-water     (period/plays)
 *                   -> python result cache         (maxAge)
 *                   -> edge cache of /game/<id>    (maxAge + swr)
 */

export type LiveView = {
    period: number | null;
    clock: string | null;
    scores: number[];
    state: string;          // ESPN status.type.state: pre | in | post
};

export type EdgeView = {
    status: string | null;  // cf-cache-status
    age: number | null;     // seconds
    scores: number[] | null; // parsed out of the rendered page, when we can
};

export type Contributor = { layer: string; seconds: number };

export type Verdict = {
    /** best-effort seconds a visitor could be behind ESPN */
    behind: number;
    /** true when the rendered / cached score differs from ESPN live */
    scoreDrift: boolean;
    /** largest contributor first; empty when everything is fresh */
    why: Contributor[];
};

const sameScores = (a: number[] | null, b: number[] | null) =>
    !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/** Seconds since `fetchedAt` (ms epoch) as of `now`; null when unknown. */
export function kvAge(fetchedAt: number | null | undefined, now = Date.now()): number | null {
    return fetchedAt == null ? null : Math.max(0, Math.round((now - fetchedAt) / 1000));
}

/**
 * Compose the layers into one verdict. Every input may be missing; a missing
 * layer contributes nothing rather than inventing a number.
 */
export function assess(opts: {
    espn: LiveView;
    kvScoreboard?: { view: LiveView | null; age: number | null };
    edge?: EdgeView | null;
    /** page-level edge for "/" when assessing the scoreboard itself */
}): Verdict {
    const why: Contributor[] = [];
    let drift = false;

    if (opts.kvScoreboard) {
        const { view, age } = opts.kvScoreboard;
        if (age != null && age > 0) why.push({ layer: "kv scoreboard", seconds: age });
        if (view && !sameScores(view.scores, opts.espn.scores)) drift = true;
    }
    if (opts.edge) {
        const { status, age, scores } = opts.edge;
        if (age != null && age > 0) why.push({ layer: `edge ${status ?? "?"}`, seconds: age });
        if (scores && !sameScores(scores, opts.espn.scores)) drift = true;
    }
    why.sort((a, b) => b.seconds - a.seconds);
    return { behind: why.reduce((s, c) => s + c.seconds, 0), scoreDrift: drift, why };
}

/** "Game: North Carolina 3, TCU 0 | Game on Paper" -> [3, 0] (home, away order as rendered). */
export function scoresFromTitle(html: string): number[] | null {
    const m = html.match(/<title>Game:\s*(.+?)\s*\|/i);
    if (!m) return null;
    const nums = [...m[1].matchAll(/\s(\d+)(?:,|$)/g)].map((x) => Number(x[1]));
    return nums.length === 2 ? nums : null;
}
