import { afterEach, expect, test, vi } from 'vitest';

const inits: Record<string, RequestInit | undefined> = {};
let respond: (u: string) => Response = () => new Response(JSON.stringify({ espn_id: '4837248' }), { status: 200 });

vi.mock('../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: RequestInit) => {
        const u = String(url);
        inits[u] = init;
        if (init?.signal?.aborted) throw init.signal.reason;
        if (u.endsWith('/v1/meta')) return new Response(JSON.stringify({ datasets: {} }), { status: 200 });
        return respond(u);
    } }));

afterEach(() => { vi.restoreAllMocks(); for (const k of Object.keys(inits)) delete inits[k]; });

test('player reads carry the player timeout signal', async () => {
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { timeouts.push(ms); return real(ms); });
    const { retrievePlayer, PLAYER_READ_TIMEOUT_MS } = await import('../src/resources/sdv');
    await retrievePlayer('4837248');
    const read = Object.entries(inits).find(([u]) => u.includes('/players/4837248'));
    expect(read?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(timeouts).toContain(PLAYER_READ_TIMEOUT_MS);
});

test('a stalled player read fails as a 504 instead of hanging the page', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    const { retrievePlayerSeasons, SDVRequestError } = await import('../src/resources/sdv');
    const err = await retrievePlayerSeasons('4837248').catch((e) => e);
    expect(err).toBeInstanceOf(SDVRequestError);
    expect(err.status).toBe(504);
});

test('a 404 is still "no such player", not an error', async () => {
    respond = () => new Response('{"detail":"not found"}', { status: 404 });
    const { retrievePlayer } = await import('../src/resources/sdv');
    expect(await retrievePlayer('1')).toBeNull();
});
