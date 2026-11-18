/**
 * The Latest strip's refresh (BB-G41, 'bball-latest-strip'; Nov 17 decisions, #445): every 30 s while the game is live,
 * `next` refetches the page's own render and swaps the strip in. It answers false once the page has no live strip (the
 * game went final): the poll stops. A failed refetch keeps polling; a hidden tab skips its turns.
 */
export const LATEST_POLL_MS = 30_000;

export function pollLatest(next: () => Promise<boolean>, opts: { every?: number; hidden?: () => boolean } = {}): () => void {
    const every = opts.every ?? LATEST_POLL_MS;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
        if (stopped) return;
        let keep = true;
        if (!opts.hidden?.()) {
            try { keep = await next(); } catch { keep = true; }
        }
        if (keep && !stopped) timer = setTimeout(tick, every);
    };
    timer = setTimeout(tick, every);
    return () => { stopped = true; clearTimeout(timer); };
}
