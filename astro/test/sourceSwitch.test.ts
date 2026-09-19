import { beforeEach, describe, expect, test, vi } from 'vitest';

// The 'source-switch' preview flag (utils/features.ts) is the only path that
// sends `?source=` to the Python API and the only one that renders a game when
// ESPN's cdn has nothing. These pin the three things that must hold with the
// flag OFF -- same request, same cache key, same "Game Not Found" -- and the
// three the flag turns on: the parameter reaches the API, it reaches the cache
// key too, and a dead cdn falls back to the API's own header.

const calls: { url: string; init: any }[] = [];
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init: any) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(processedPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

let guardedPage: any = null;
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveGamePageGuarded: async () => ({ page: guardedPage, regressed: false, reason: null }),
}));

const HEADER = {
    id: '401772944',
    competitions: [{
        date: '2025-11-02T17:00Z',
        status: { type: { name: 'STATUS_FINAL', completed: true, state: 'post', detail: 'Final', description: 'Final' } },
    }],
};
const processedPayload = () => ({
    plays: [{ id: '1', scoringPlay: false, winProbability: { before: 0.5, after: 0.6, added: 0.1 } }],
    advBoxScore: { team: [{}, {}] },
    drives: { previous: [{}] },
    teamInfo: { home: { id: '7' }, away: { id: '13' } },
    header: HEADER,
});

function fakeAstro(url: string, locals: Record<string, unknown>) {
    const headers = new Headers();
    const cacheCalls: unknown[] = [];
    return {
        astro: {
            params: { id: '401772944' },
            locals,
            url: new URL(url),
            response: { headers },
            cache: { set: (v: unknown) => cacheCalls.push(v) },
            redirect: (l: string) => l,
        } as any,
        headers,
        cacheCalls,
    };
}

beforeEach(() => { calls.length = 0; guardedPage = null; });

describe('the source-switch flag', () => {
    test('is a preview feature, like every other unpromoted surface', async () => {
        const { FLAGS, isFeatureEnabled } = await import('../src/utils/features');
        expect(FLAGS['source-switch']).toBe('preview');
        expect(isFeatureEnabled('source-switch', {})).toBe(false);
        expect(isFeatureEnabled('source-switch', { preview: true })).toBe(true);
    });
});

describe('the processed-game cache key', () => {
    test('is untouched without a source, and carries it with one', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        await retrieveProcessedGame(1, 30, 'nfl');
        await retrieveProcessedGame(1, 30, 'nfl', 'shield');
        const [plain, switched] = calls;
        expect(plain.url).toMatch(/\/nfl\/1\/process$/);
        expect(plain.init.cf.cacheKey).toMatch(/\/nfl\/1\/process\?v=[^&]*$/);
        expect(switched.url).toMatch(/\/nfl\/1\/process\?source=shield$/);
        // the key must split by source: one key for two different payloads is
        // the live-page-freeze class of bug (a completed game caches a year)
        expect(switched.init.cf.cacheKey).toContain('&source=shield');
        expect(switched.init.cf.cacheKey).not.toBe(plain.init.cf.cacheKey);
    });

    test('a source is url-encoded, never interpolated raw', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        await retrieveProcessedGame(1, 30, 'cfb', 'a&v=x');
        expect(calls[0].url).toContain('source=a%26v%3Dx');
        expect(calls[0].init.cf.cacheKey).toContain('&source=a%26v%3Dx');
    });
});

describe('loadGameRoute', () => {
    test('with the flag off, ?source= is ignored and a dead cdn is still Game Not Found', async () => {
        const { loadGameRoute } = await import('../src/routes/game');
        const { astro, headers } = fakeAstro('https://gameonpaper.com/nfl/game/401772944?source=shield', {});
        const r: any = await loadGameRoute(astro, 'nfl');
        expect(r.espnGame).toBeNull();
        expect(r.game).toBeNull();
        expect(r.headerFallback).toBe(false);
        expect(calls).toHaveLength(0);       // the API was never called
        expect(headers.get('Cache-Control')).toBe('no-store');
    });

    test('with the flag off and ESPN healthy, the API request is the one it is today', async () => {
        guardedPage = { gameId: 401772944, gamepackageJSON: { header: HEADER } };
        const { loadGameRoute } = await import('../src/routes/game');
        const { astro } = fakeAstro('https://gameonpaper.com/nfl/game/401772944?source=shield', {});
        const r: any = await loadGameRoute(astro, 'nfl');
        expect(r.gameRenderable).toBe(true);
        expect(calls[0].url).toMatch(/\/nfl\/401772944\/process$/);
    });

    test('with the flag on but no admin session, ?source= is still ignored', async () => {
        // `?source=` is an admin tool: the preview cookie alone must not move
        // the request or its cache key off the default path.
        guardedPage = { gameId: 401772944, gamepackageJSON: { header: HEADER } };
        const { loadGameRoute } = await import('../src/routes/game');
        const { astro } = fakeAstro('https://gameonpaper.com/nfl/game/401772944?source=shield', { preview: true });
        await loadGameRoute(astro, 'nfl');
        expect(calls[0].url).toMatch(/\/nfl\/401772944\/process$/);
        expect(calls[0].init.cf.cacheKey).not.toContain('source=');
    });

    test('with the flag on and an admin session, ?source= reaches the API', async () => {
        guardedPage = { gameId: 401772944, gamepackageJSON: { header: HEADER } };
        const { loadGameRoute } = await import('../src/routes/game');
        const { astro } = fakeAstro('https://gameonpaper.com/nfl/game/401772944?source=shield', { preview: true, adminAuthed: true });
        await loadGameRoute(astro, 'nfl');
        expect(calls[0].url).toMatch(/\/nfl\/401772944\/process\?source=shield$/);
    });

    test('with the flag on and the cdn dead, the header comes from the API payload', async () => {
        const { loadGameRoute } = await import('../src/routes/game');
        const { astro, headers } = fakeAstro('https://gameonpaper.com/nfl/game/401772944', { preview: true });
        const r: any = await loadGameRoute(astro, 'nfl');
        expect(r.headerFallback).toBe(true);
        expect(r.espnGame.gamepackageJSON.header).toBe(r.game.header);
        expect(r.gameRenderable).toBe(true);
        expect(r.pregameState).toBe(false);
        // one API call, not two: the fallback IS the processed fetch
        expect(calls).toHaveLength(1);
        // a render without ESPN is a degraded render; never let it be cached
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});
