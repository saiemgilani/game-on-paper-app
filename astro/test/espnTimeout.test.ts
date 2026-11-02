import { afterEach, expect, test, vi } from 'vitest';
import { ESPN_TIMEOUT_MS, retrieveGamePage } from '../src/resources/espn';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const PBP = JSON.stringify({ gamepackageJSON: {} });

test('every ESPN attempt carries its own timeout signal, retries included', async () => {
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { timeouts.push(ms); return real(ms); });
    const signals: (AbortSignal | undefined)[] = [];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined);
        return n++ === 0 ? new Response('busy', { status: 503 }) : new Response(PBP, { status: 200 });
    }));
    await retrieveGamePage(401856682).catch(() => {}); // only the request options matter here
    expect(timeouts).toEqual([ESPN_TIMEOUT_MS, ESPN_TIMEOUT_MS]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
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
