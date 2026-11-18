/**
 * The Latest strip's refresh (BB-G41, 'bball-latest-strip'; Nov 17 decisions, #445): every 30 s while the game is live,
 * `next` refetches the page's own render and swaps the strip in. It answers false once the refetched page is a final: the
 * poll stops. A failed or stalled refetch (past `deadline`, its signal aborted) is logged and the poll goes on; a hidden
 * tab skips its turns.
 */
export const LATEST_POLL_MS = 30_000;
// the slowest render that still succeeds: an ESPN read (ESPN_TIMEOUT_MS, 10 s) then the processor (NBA_PROCESSOR_TIMEOUT_MS,
// 25 s), plus 5 s for the rest. Not imported, so the client bundle stays free of the server modules; keep it in step with them.
// A render past it was a 503 anyway. The next turn waits for this one, so refetches never overlap.
export const LATEST_DEADLINE_MS = 40_000;

/**
 * Swap the refetched page's strip into this one; true while the poll should go on. A refetched page with no strip that is
 * not a final (`[data-latest-pending]`: suspended, or live with no plays yet) keeps this strip and the poll. A final: this
 * page's stale live panel and its nav entries (the link and the phone-width picker's option) are removed and false stops
 * the poll (a reload shows the final's panels).
 */
export function swapLatest(page: Document, fetched: Document): boolean {
    const el = page.querySelector('[data-latest-poll]');
    const next = fetched.querySelector('[data-latest-poll]');
    if (!el) return false;
    if (!next) {
        if (fetched.querySelector('[data-latest-pending]')) return true;
        (el.closest('#latest-panel') ?? el).remove();
        const nav = page.querySelector('a[href="#latest"]');
        (nav?.closest('li') ?? nav)?.remove();
        // the phone-width section picker's entry; a selected Latest hands the selection back to the placeholder first, so
        // picking the next section still fires `change`
        const picker = page.querySelector<HTMLSelectElement>('#game-section-picker');
        const opt = picker?.querySelector<HTMLOptionElement>('option[value="#latest"]');
        if (picker && opt?.selected) picker.selectedIndex = 0;
        opt?.remove();
        return false;
    }
    el.replaceChildren(...Array.from(next.childNodes, (n) => page.importNode(n, true)));
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
