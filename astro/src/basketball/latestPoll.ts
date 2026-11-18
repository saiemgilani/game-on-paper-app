/**
 * The Latest strip's refresh (BB-G41, 'bball-latest-strip'; Nov 17 decisions, #445): every 30 s while the game is live,
 * `next` refetches the page's own render and swaps the strip in. It answers false once the page has no live strip (the
 * game went final): the poll stops. A failed or stalled refetch (past `deadline`, its signal aborted) is logged and the
 * poll goes on; a hidden tab skips its turns.
 */
export const LATEST_POLL_MS = 30_000;
export const LATEST_DEADLINE_MS = 10_000;

/**
 * Swap the refetched page's strip into this one; true while live. A refetched page with no strip (the game went final):
 * this page's stale live panel and its nav item are removed and false stops the poll (a reload shows the final's panels).
 */
export function swapLatest(page: Document, fetched: Document): boolean {
    const el = page.querySelector('[data-latest-poll]');
    const next = fetched.querySelector('[data-latest-poll]');
    if (!el) return false;
    if (!next) {
        (el.closest('#latest-panel') ?? el).remove();
        const nav = page.querySelector('a[href="#latest"]');
        (nav?.closest('li') ?? nav)?.remove();
        return false;
    }
    el.innerHTML = next.innerHTML;
    return true;
}

export function pollLatest(next: (signal: AbortSignal) => Promise<boolean>, opts: { every?: number; deadline?: number; hidden?: () => boolean } = {}): () => void {
    const every = opts.every ?? LATEST_POLL_MS;
    const deadline = opts.deadline ?? LATEST_DEADLINE_MS;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
        if (stopped) return;
        let keep = true;
        if (!opts.hidden?.()) {
            const abort = new AbortController();
            let late: ReturnType<typeof setTimeout> | undefined;
            // the race settles a refetch that ignores its signal, so one stalled request never ends the poll
            const timedOut = new Promise<never>((_, reject) => { late = setTimeout(() => { abort.abort(); reject(new Error(`refetch past ${deadline} ms`)); }, deadline); });
            try { keep = await Promise.race([next(abort.signal), timedOut]); }
            catch (e) { console.warn('Latest strip: refetch failed, retrying', e); keep = true; }
            finally { clearTimeout(late); }
        }
        if (keep && !stopped) timer = setTimeout(tick, every);
    };
    timer = setTimeout(tick, every);
    return () => { stopped = true; clearTimeout(timer); };
}
