import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:workers';

// L-sources: a durable per-game source override ("keeps a game on a different
// source until the override is removed"). Pinned in KV, honoured by every path
// that processes the game wherever 'source-switch' is on, inert where it is
// off, and set/removed only through the audited admin endpoint.


type Responder = (url: string) => Response;
const ok = () => new Response(JSON.stringify(processedPayload()), { status: 200 });
let respond: Responder = ok;
const calls: { url: string; init: any }[] = [];
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init: any) => {
        calls.push({ url: String(url), init });
        return respond(String(url));
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
        competitors: [
            { score: '24', team: { id: '7', abbreviation: 'HOME', location: 'Home', displayName: 'Home Team' } },
            { score: '17', team: { id: '13', abbreviation: 'AWAY', location: 'Away', displayName: 'Away Team' } },
        ],
        broadcasts: [],
    }],
};
const processedPayload = () => ({
    plays: [{ id: '1', scoringPlay: false, winProbability: { before: 0.5, after: 0.6, added: 0.1 } }],
    advBoxScore: { team: [{}, {}] },
    drives: { previous: [{}] },
    teamInfo: { home: { id: '7', abbreviation: 'HOME' }, away: { id: '13', abbreviation: 'AWAY' } },
    header: HEADER,
});
const PIN = { source: 'shield', actor: 'saiem', set_at: '2026-11-01T20:00:00.000Z' };

// A real-enough KV: the stub is an always-miss, these tests need it to hold values.
const kv = new Map<string, { value: string; metadata?: unknown }>();
beforeEach(() => {
    calls.length = 0; guardedPage = { gameId: 401772944, gamepackageJSON: { header: HEADER } }; respond = ok; kv.clear();
    vi.spyOn(env.ESPN_API_CACHE, 'get').mockImplementation((async (k: string, type?: string) => {
        const hit = kv.get(k);
        return hit ? (type === 'json' ? JSON.parse(hit.value) : hit.value) : null;
    }) as any);
    vi.spyOn(env.ESPN_API_CACHE, 'put').mockImplementation((async (k: string, value: string, opts?: any) => {
        kv.set(k, { value, metadata: opts?.metadata });
    }) as any);
    vi.spyOn(env.ESPN_API_CACHE, 'delete').mockImplementation((async (k: string) => { kv.delete(k); }) as any);
    env.ESPN_API_CACHE.list = async ({ prefix }: { prefix: string }) => ({
        keys: [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata })),
        list_complete: true,
    });
});
afterEach(() => { vi.restoreAllMocks(); });
const pin = (league = 'nfl', id = '401772944') => kv.set(`source-override:${league}:${id}`, { value: JSON.stringify(PIN), metadata: PIN });

function fakeAstro(url: string, locals: Record<string, unknown>) {
    const headers = new Headers();
    return {
        params: { id: '401772944' }, locals, url: new URL(url), response: { headers },
        cache: { set: () => {} }, redirect: (l: string) => l,
    } as any;
}
const processCalls = () => calls.filter((c) => c.url.includes('/process'));

describe('effectiveSource', () => {
    test("an admin's explicit ?source= beats the pin, and espn means the default path", async () => {
        const { effectiveSource } = await import('../src/utils/sourceOverride');
        expect(effectiveSource(null, null)).toBeUndefined();
        expect(effectiveSource(null, PIN)).toBe('shield');
        expect(effectiveSource('cbs', PIN)).toBe('cbs');
        expect(effectiveSource('espn', PIN)).toBeUndefined();
        expect(effectiveSource(null, { ...PIN, source: 'espn' })).toBeUndefined();
    });

    test('with the flag off the pin is never even read', async () => {
        const { gameSource } = await import('../src/utils/sourceOverride');
        pin();
        expect(await gameSource('nfl', '401772944', false)).toBeUndefined();
        expect(env.ESPN_API_CACHE.get).not.toHaveBeenCalled();
    });

    test('a KV failure is no pin, not a broken page', async () => {
        const { gameSource } = await import('../src/utils/sourceOverride');
        vi.mocked(env.ESPN_API_CACHE.get).mockRejectedValue(new Error('kv down'));
        expect(await gameSource('nfl', '401772944', true)).toBeUndefined();
    });
});

describe('the game page honours the pin', () => {
    test('flag off: a pinned game sends the request it sends today', async () => {
        pin();
        const { loadGameRoute } = await import('../src/routes/game');
        await loadGameRoute(fakeAstro('https://gameonpaper.com/nfl/game/401772944', {}), 'nfl');
        expect(processCalls()[0].url).toMatch(/\/nfl\/401772944\/process$/);
    });

    test('flag on, no admin session: every viewer gets the pinned source, on its own cache key', async () => {
        pin();
        const { loadGameRoute } = await import('../src/routes/game');
        const r: any = await loadGameRoute(fakeAstro('https://gameonpaper.com/nfl/game/401772944', { preview: true }), 'nfl');
        expect(r.gameRenderable).toBe(true);
        expect(processCalls()[0].url).toMatch(/\/nfl\/401772944\/process\?source=shield$/);
        expect(processCalls()[0].init.cf.cacheKey).toContain('&source=shield');
    });

    test("a viewer's ?source= is ignored without an admin session; the pin still decides", async () => {
        pin();
        const { loadGameRoute } = await import('../src/routes/game');
        await loadGameRoute(fakeAstro('https://gameonpaper.com/nfl/game/401772944?source=cbs', { preview: true }), 'nfl');
        expect(processCalls()[0].url).toMatch(/\?source=shield$/);
    });

    test('an admin can still look at ESPN on a pinned game', async () => {
        pin();
        const { loadGameRoute } = await import('../src/routes/game');
        await loadGameRoute(fakeAstro('https://gameonpaper.com/nfl/game/401772944?source=espn', { preview: true, adminAuthed: true }), 'nfl');
        expect(processCalls()[0].url).toMatch(/\/process$/);
    });

    test('a pin the deploy no longer serves (400) falls back to ESPN instead of taking the page down', async () => {
        pin();
        respond = (url) => url.includes('source=') ? new Response('unknown source', { status: 400 }) : ok();
        const { loadGameRoute } = await import('../src/routes/game');
        const r: any = await loadGameRoute(fakeAstro('https://gameonpaper.com/nfl/game/401772944', { preview: true }), 'nfl');
        expect(r.gameRenderable).toBe(true);
        expect(processCalls().map((c) => c.url.split('/process')[1])).toEqual(['?source=shield', '']);
    });

    test("an admin's explicit ?source= that the processor refuses (400) is an error, never ESPN under that source's label", async () => {
        respond = (url) => url.includes('source=') ? new Response('unknown source', { status: 400 }) : ok();
        const { loadGameRoute } = await import('../src/routes/game');
        const r: any = await loadGameRoute(fakeAstro('https://gameonpaper.com/nfl/game/401772944?source=cbs', { preview: true, adminAuthed: true }), 'nfl');
        expect(r.game).toBeNull();
        expect(processCalls().map((c) => c.url.split('/process')[1])).toEqual(['?source=cbs']);
    });

    test('the share card asks for the same request, so it shares the page entry', async () => {
        const { retrieveCardPage } = await import('../src/resources/python');
        await retrieveCardPage('401772944', 'nfl', 30, 'shield');
        expect(processCalls()[0].url).toMatch(/\/nfl\/401772944\/process\?source=shield$/);
        expect(processCalls()[0].init.cf.cacheKey).toContain('&source=shield');
    });

    test('a retired pin (400) falls back to ESPN for the share card and the QA badge too', async () => {
        respond = (url) => url.includes('source=') ? new Response('unknown source', { status: 400 }) : ok();
        const { retrieveCardPage, retrieveProcessedGame } = await import('../src/resources/python');
        expect(await retrieveCardPage('401772944', 'nfl', 30, 'shield', true)).not.toBeNull();
        // liveQa reads through retrieveProcessedGame
        expect((await retrieveProcessedGame('401772944', 30, 'nfl', 'shield', true)).plays).toHaveLength(1);
        expect(processCalls().map((c) => c.url.split('/process')[1])).toEqual(['?source=shield', '', '?source=shield', '']);
    });

    test('without the pin flag a refused source throws: the fallback is for pins only', async () => {
        respond = (url) => url.includes('source=') ? new Response('unknown source', { status: 400 }) : ok();
        const { retrieveCardPage, retrieveProcessedGame } = await import('../src/resources/python');
        await expect(retrieveProcessedGame('401772944', 30, 'nfl', 'shield')).rejects.toThrow();
        // retrieveCardPage fails open to null rather than drawing ESPN's game as this source's
        expect(await retrieveCardPage('401772944', 'nfl', 30, 'shield')).toBeNull();
        expect(processCalls().map((c) => c.url.split('/process')[1])).toEqual(['?source=shield', '?source=shield']);
    });

    test('any other processor failure on a pinned source is not papered over', async () => {
        respond = (url) => url.includes('source=') ? new Response('boom', { status: 500 }) : ok();
        const { retrieveProcessedGame } = await import('../src/resources/python');
        await expect(retrieveProcessedGame('401772944', 30, 'nfl', 'shield', true)).rejects.toThrow();
        expect(processCalls()).toHaveLength(1);
    });

    test('a kept share card is keyed per source, the ESPN key unchanged', async () => {
        const { cardKey } = await import('../src/routes/shareCard');
        const espn = cardKey('nfl', 1, 'final', 'full');
        expect(cardKey('nfl', 1, 'final', 'full', undefined)).toBe(espn);
        expect(cardKey('nfl', 1, 'final', 'full', 'shield')).toBe(`${espn}:shield`);
    });

    test('the registry lookup is timeboxed, so a stalled processor cannot hang a pin', async () => {
        respond = () => new Response(JSON.stringify({ sources: ['espn'] }), { status: 200 });
        const { retrieveGameSources } = await import('../src/resources/python');
        await retrieveGameSources('401772944', 'nfl');
        expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    });
});

describe('POST /admin/api/source-override', () => {
    const registry = () => new Response(JSON.stringify({ game_id: '401772944', sources: ['espn', 'shield', 'cbs'] }), { status: 200 });
    async function post(body: unknown, contentType = 'application/json', invalidate?: (o: unknown) => Promise<void>) {
        const { POST } = await import('../src/pages/admin/api/source-override');
        const { gopStorage, createCollector } = await import('../src/utils/telemetry');
        const invalidated: unknown[] = [];
        const collector = createCollector();
        const res = await gopStorage.run(collector, () => (POST as any)({
            request: new Request('https://gameonpaper.com/admin/api/source-override',
                { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': contentType } }),
            locals: { adminAuthed: true, adminActor: 'saiem' },
            cache: { invalidate: invalidate ?? (async (o: unknown) => { invalidated.push(o); }), set: () => {} },
        }));
        return { res: res as Response, json: await (res as Response).json(), invalidated, audit: collector.events.filter((e) => e.table === 'admin_audit') };
    }

    test('rejects anything that is not a known league, a game id and a source, and audits each refusal', async () => {
        for (const body of [{ league: 'nba', id: '401772944', source: 'shield' }, { league: 'nfl', id: '12', source: 'shield' },
            { league: 'nfl', id: '401772944', source: 5 }, { league: 'nfl', id: '401772944', source: 'espn' }]) {
            const { res, audit } = await post(body);
            expect(res.status).toBe(400);
            expect(audit).toHaveLength(1);
            expect(audit[0].row).toMatchObject({ action: 'source-override', ok: false, actor: 'saiem' });
        }
        expect(kv.size).toBe(0);
    });

    test('takes application/json only: a form-type body, which a cross-site page can send without a preflight, is refused', async () => {
        respond = registry;
        for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
            const { res, audit } = await post({ league: 'nfl', id: '401772944', source: 'shield' }, type);
            expect(res.status).toBe(415);
            expect(audit[0].row).toMatchObject({ ok: false });
        }
        expect(kv.size).toBe(0);
        expect(calls).toHaveLength(0);   // refused before the registry is even asked
    });

    test('a failed purge is reported and audited as not ok; the pin itself stands', async () => {
        respond = registry;
        const { json, audit } = await post({ league: 'nfl', id: '401772944', source: 'shield' }, 'application/json',
            async () => { throw new Error('no cache provider'); });
        expect(json).toMatchObject({ ok: true, purged: false });
        expect(kv.has('source-override:nfl:401772944')).toBe(true);
        expect(audit[0].row).toMatchObject({ ok: false, detail: 'nfl:401772944 shield (page purge failed)' });
    });

    test("rejects a source outside the game's registry, and audits the attempt", async () => {
        respond = registry;
        const { res, audit } = await post({ league: 'nfl', id: '401772944', source: 'yahoo' });
        expect(res.status).toBe(400);
        expect(kv.size).toBe(0);
        expect(audit[0].row).toMatchObject({ action: 'source-override', ok: false, actor: 'saiem' });
    });

    test('pins durably, purges the page and its card, and audits who did it', async () => {
        respond = registry;
        const { res, json, invalidated, audit } = await post({ league: 'nfl', id: '401772944', source: 'shield' });
        expect(res.status).toBe(200);
        expect(json.ok).toBe(true);
        expect(env.ESPN_API_CACHE.put).toHaveBeenCalledWith('source-override:nfl:401772944', expect.any(String), expect.objectContaining({ metadata: expect.objectContaining({ source: 'shield', actor: 'saiem' }) }));
        // no expirationTtl: it lasts until removed
        expect(vi.mocked(env.ESPN_API_CACHE.put).mock.calls[0][2]).not.toHaveProperty('expirationTtl');
        expect(invalidated).toEqual([{ path: '/nfl/game/401772944' }, { path: '/nfl/game/401772944/card.png' }]);
        expect(json.purged).toBe(true);
        expect(audit[0].row).toMatchObject({ action: 'source-override', detail: 'nfl:401772944 shield', ok: true, actor: 'saiem' });
    });

    test('a cfb game purges the unprefixed page', async () => {
        respond = registry;
        const { invalidated } = await post({ league: 'cfb', id: '401772944', source: 'shield' });
        expect(invalidated[0]).toEqual({ path: '/game/401772944' });
    });

    test('lists every pin from metadata, and removing one deletes it and is audited', async () => {
        respond = registry;
        await post({ league: 'nfl', id: '401772944', source: 'shield' });
        const { GET } = await import('../src/pages/admin/api/source-override');
        const listed = await (await (GET as any)({})).json();
        expect(listed.overrides).toEqual([{ league: 'nfl', game_id: '401772944', source: 'shield', actor: 'saiem', set_at: expect.any(String) }]);
        const { json, audit } = await post({ league: 'nfl', id: '401772944', source: null });
        expect(json.ok).toBe(true);
        expect(kv.size).toBe(0);
        expect(audit[0].row).toMatchObject({ detail: 'nfl:401772944 removed', ok: true });
    });

    test('a list cut at the cap says so instead of passing as complete', async () => {
        env.ESPN_API_CACHE.list = async () => ({
            keys: Array.from({ length: 1000 }, (_, i) => ({ name: `source-override:cfb:40000${i}`, metadata: PIN })),
            list_complete: false, cursor: 'next',
        });
        const { GET } = await import('../src/pages/admin/api/source-override');
        const listed = await (await (GET as any)({})).json();
        expect(listed.overrides).toHaveLength(2000);
        expect(listed.truncated).toBe(true);
    });

    test('a KV failure on the list is a 500 with ok:false, not an empty list', async () => {
        env.ESPN_API_CACHE.list = async () => { throw new Error('kv down'); };
        const { GET } = await import('../src/pages/admin/api/source-override');
        const res = await (GET as any)({});
        expect(res.status).toBe(500);
        expect((await res.json()).ok).toBe(false);
    });
});

describe('purge-game, the re-purge the pin docs send admins to', () => {
    async function purge(query: string) {
        const { POST } = await import('../src/pages/admin/api/purge-game');
        const invalidated: unknown[] = [];
        const res = await (POST as any)({
            url: new URL(`https://gameonpaper.com/admin/api/purge-game?${query}`),
            request: new Request(`https://gameonpaper.com/admin/api/purge-game?${query}`, { method: 'POST' }),
            locals: { adminAuthed: true, adminActor: 'saiem' },
            cache: { invalidate: async (o: unknown) => { invalidated.push(o); }, set: () => {} },
        });
        return { res: res as Response, invalidated };
    }

    test("an id purges both leagues' share cards along with the pages", async () => {
        const { res, invalidated } = await purge('ids=401772944');
        expect(res.status).toBe(200);
        expect(invalidated).toEqual(expect.arrayContaining([
            { path: '/game/401772944' }, { path: '/nfl/game/401772944' },
            { path: '/game/401772944/card.png' }, { path: '/nfl/game/401772944/card.png' },
        ]));
    });

    test("the share-card tag is purgeable (the route caches every card under it)", async () => {
        const { res, invalidated } = await purge('tags=share-card');
        expect(res.status).toBe(200);
        expect(invalidated).toEqual([{ tags: ['share-card'] }]);
    });
});

describe('the pin controls in the admin tools', () => {
    let container: AstroContainer;
    beforeAll(async () => {
        container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    });
    const render = async (locals: Record<string, unknown>, search = '') => {
        // no render may reach the API: the registry falls back to ESPN alone and the compare panel to empty
        respond = (url) => { throw new Error(`unexpected fetch in test: ${url}`); };
        const { default: AdminGameTools } = await import('../src/components/game/AdminGameTools.astro');
        return container.renderToString(AdminGameTools, {
            props: { game: processedPayload() as any },
            request: new Request(`https://gameonpaper.com/nfl/game/401772944${search}`),
            locals: { league: 'nfl', ...locals } as any,
        });
    };

    test('nobody without an admin session sees a pin control or its script', async () => {
        pin();
        const html = await render({ preview: true });
        expect(html).not.toContain('data-admin-source-pin');
        expect(html).not.toContain('source-override');
    });

    test('a pinned game shows the pin and an Unpin button', async () => {
        pin();
        const html = await render({ preview: true, adminAuthed: true });
        expect(html).toContain('Pinned: shield');
        expect(html).toContain('data-pin=""');
        expect(html).not.toContain('Pin shield');
    });

    test('viewing an unpinned alternate source offers to pin it', async () => {
        const html = await render({ preview: true, adminAuthed: true }, '?source=cbs');
        expect(html).toContain('data-pin="cbs"');
        expect(html).not.toContain('>Unpin<');
    });

    test('an unpinned ESPN view offers nothing', async () => {
        const html = await render({ preview: true, adminAuthed: true });
        expect(html).not.toContain('data-admin-source-pin');
    });
});
