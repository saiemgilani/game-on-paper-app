import { afterEach, expect, test, vi } from 'vitest';
import { ESPN_TIMEOUT_MS, retrieveGamePage, retrieveGameSummary } from '../src/resources/espn';

// the 403 relay needs its URL; everything else reads the real (dummy) secrets
vi.mock('astro:env/server', async (orig) => {
    const real = await orig<typeof import('astro:env/server')>();
    return { ...real, getSecret: (k: string) => (k === 'PYTHON_HTTP_URL' ? 'http://localhost:5000' : real.getSecret(k as any)) };
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const PBP = JSON.stringify({ gamepackageJSON: {} });

/** Spy on AbortSignal.timeout, keeping the real signals, and record each (ms, signal) it hands out. */
const spyTimeouts = () => {
    const made: { ms: number; signal: AbortSignal }[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { const signal = real(ms); made.push({ ms, signal }); return signal; });
    return made;
};

test('the ESPN budget is 10 s per attempt', () => {
    expect(ESPN_TIMEOUT_MS).toBe(10_000); // the PR's promise, not just "whatever the constant says"
});

test('every ESPN attempt carries its own 10 s timeout signal, retries included', async () => {
    const made = spyTimeouts();
    const signals: (AbortSignal | null | undefined)[] = [];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
        signals.push(init?.signal);
        return n++ === 0 ? new Response('busy', { status: 503 }) : new Response(PBP, { status: 200 });
    }));
    await retrieveGamePage(401856682).catch(() => {}); // only the request options matter here
    expect(made.map((m) => m.ms)).toEqual([10_000, 10_000]);
    expect(signals).toEqual(made.map((m) => m.signal)); // each attempt uses exactly the timeout signal made for it
    expect(signals[1]).not.toBe(signals[0]); // a retry must not inherit the first attempt's spent window
});

test('a stalled ESPN read rejects instead of hanging the render', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    // fetch that never answers unless its signal fires, like a stalled connection
    vi.stubGlobal('fetch', vi.fn((_u: unknown, init?: RequestInit) => new Promise((_, reject) => {
        const s = init?.signal;
        if (!s) return; // no signal: hang forever, which is the bug
        if (s.aborted) reject(s.reason);
        s.addEventListener('abort', () => reject(s.reason));
    })));
    await expect(retrieveGamePage(401856682)).rejects.toMatchObject({ name: 'TimeoutError' });
});

test("the 403 relay runs under the caller's own deadline, not a fresh 10 s", async () => {
    const seen: Record<string, AbortSignal | null | undefined> = {};
    vi.stubGlobal('fetch', vi.fn(async (u: unknown, init?: RequestInit) => {
        const url = String(u);
        if (url.includes('/espn/proxy')) { seen.relay = init?.signal; return new Response('{}', { status: 200 }); }
        seen.espn = init?.signal;
        return new Response('denied', { status: 403 });
    }));
    const caller = AbortSignal.timeout(3000);
    await retrieveGameSummary(7, 'nba', caller);
    expect(seen.espn).toBe(caller);
    expect(seen.relay).toBe(caller);
});
