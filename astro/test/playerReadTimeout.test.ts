import { afterEach, expect, test, vi } from 'vitest';

const inits: Record<string, RequestInit | undefined> = {};
type Respond = (u: string, init?: RequestInit) => Promise<Response>;
const okPlayer: Respond = async () => new Response(JSON.stringify({ espn_id: '4837248' }), { status: 200 });
let respond: Respond = okPlayer;

vi.mock('../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: RequestInit) => {
        const u = String(url);
        inits[u] = init;
        if (u.endsWith('/v1/meta')) return new Response(JSON.stringify({ datasets: {} }), { status: 200 });
        return respond(u, init);
    } }));

afterEach(() => { vi.restoreAllMocks(); respond = okPlayer; for (const k of Object.keys(inits)) delete inits[k]; });

/** a request that is still pending when its signal fires, like a stalled connection */
const stalled: Respond = (_u, init) => new Promise((_, reject) => {
    const s = init?.signal;
    if (!s) return; // no signal: hangs forever, which is the bug
    s.addEventListener('abort', () => reject(s.reason));
});

test('the player read carries exactly the 10 s timeout signal', async () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    const made: { ms: number; signal: AbortSignal }[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { const signal = real(ms); made.push({ ms, signal }); return signal; });
    const { retrievePlayer, PLAYER_READ_TIMEOUT_MS } = await import('../src/resources/sdv');
    expect(PLAYER_READ_TIMEOUT_MS).toBe(10_000);
    await retrievePlayer('4837248');
    const read = Object.entries(inits).find(([u]) => u.includes('/players/4837248'));
    const mine = made.find((m) => m.ms === 10_000);
    expect(mine).toBeDefined();
    expect(read?.[1]?.signal).toBe(mine!.signal); // the read uses the very signal made for it
});

test('a read still pending when its timeout fires fails as a 504 instead of hanging', async () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    // a real, short timeout: the request is genuinely pending, then the signal expires
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => real(ms === 10_000 ? 20 : ms));
    respond = stalled;
    const { retrievePlayerSeasons, SDVRequestError } = await import('../src/resources/sdv');
    const err = await retrievePlayerSeasons('4837248').catch((e) => e);
    expect(err).toBeInstanceOf(SDVRequestError);
    expect(err.status).toBe(504);
});

test('a 404 is still "no such player", not an error', async () => {
    respond = async () => new Response('{"detail":"not found"}', { status: 404 });
    const { retrievePlayer } = await import('../src/resources/sdv');
    expect(await retrievePlayer('1')).toBeNull();
});

test('a section read that never settles degrades the page instead of hanging it', async () => {
    vi.useFakeTimers();
    try {
        const { withDeadline } = await import('../src/routes/player');
        const never = new Promise<string>(() => {}); // e.g. a team-summary read with no signal of its own
        const outcome = Promise.allSettled([withDeadline(never), withDeadline(Promise.resolve('ok'))]);
        await vi.advanceTimersByTimeAsync(10_000);
        const [stuck, fine] = await outcome;
        expect(stuck.status).toBe('rejected');
        expect(fine).toEqual({ status: 'fulfilled', value: 'ok' });
    } finally {
        vi.useRealTimers();
    }
});
