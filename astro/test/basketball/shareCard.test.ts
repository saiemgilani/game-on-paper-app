// 'bball-share-card': a basketball game's link preview is its card (basketball/shareCard.ts), drawn by the API
// (python/share_card.py render_basketball) at /<league>/game/<id>/card.png (routes/basketball/shareCard.ts). Real
// fixtures: ATL 95 at ORL 120 (401766458, final), the processor payload and the Data API rows. The page's head is
// checked in test/nba/byteIdentity.render.test.ts.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { basketballCardBody, basketballShareImage } from '../../src/basketball/shareCard';
import { fromDataApi, fromProcessor } from '../../src/resources/nbaGame';
import { ProcessorError } from '../../src/resources/python';
import { cardKey } from '../../src/routes/shareCard';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const ID = '401766458';
const EXCITEMENT = { gei: 3.54, lead_changes: 6, max_swing_pts: 9.34, completed: true };
const proc = { ...read('game_401766458_processor'), excitement: EXCITEMENT };
const api = read('game_401766458_api');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** the processor payload, mid-game: ESPN's live status on the same plays */
function liveProc() {
    const p = structuredClone(proc);
    p.status = { ...p.status, name: 'STATUS_IN_PROGRESS', completed: false, period: 3, display_clock: '5:32', detail: '5:32 - 3rd Quarter' };
    p.excitement = { ...EXCITEMENT, completed: false };
    p.header.competitions[0].status.type = { ...p.header.competitions[0].status.type, completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' };
    return p;
}

const up = vi.hoisted(() => ({
    fetched: [] as { url: string; init?: any }[],
    cardStatus: 200,
    schedule: vi.fn(), rows: vi.fn(), proc: vi.fn(), page: vi.fn(),
}));
vi.mock('../../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: any) => {
        up.fetched.push({ url: String(url), init });
        if (String(url).includes('/card.png')) return new Response(up.cardStatus === 200 ? PNG : 'no', { status: up.cardStatus });
        throw new Error(`unexpected fetch in test: ${url}`);
    },
}));
vi.mock('../../src/resources/nbaGames', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaGames')>()),
    retrieveNbaSchedule: (...a: unknown[]) => up.schedule(...a),
    retrieveNbaGameRows: (...a: unknown[]) => up.rows(...a),
    retrieveNbaProcessedGame: (...a: unknown[]) => up.proc(...a),
}));
vi.mock('../../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/espn')>()),
    retrieveGamePageGuarded: (...a: unknown[]) => up.page(...a),
}));

const espnPage = (p: any, extra: Record<string, unknown> = {}) => ({ page: { gameId: Number(ID), gamepackageJSON: { header: p.header } }, regressed: false, fetchFailed: false, ...extra });

describe('the card body and the head tags', () => {
    test('a processor final: the score, the line and the GEI', () => {
        const b = basketballCardBody(fromProcessor(proc, 'nba'), 'nba');
        expect([b.away.name, b.away.score, b.home.name, b.home.score]).toEqual(['Atlanta', 95, 'Orlando', 120]);
        expect(b.home.color).toBe(proc.teamInfo.home.color);
        expect(b.home.logo).toMatch(/^https:\/\/a\.espncdn\.com\/i\/teamlogos\/nba\/500\//);
        expect(b.plays.length).toBe(proc.plays.filter((p: any) => p.home_win_prob != null).length);
        expect(b.plays[0]).toEqual([1, proc.plays[0].home_win_prob, 2880]);
        expect(b.gei).toBe(3.54);
        expect(b.detail).toBe('Final');
        expect(b.regulation).toBe(4);
    });

    test('a live game never carries the GEI, even with sdv-py\'s running number', () => {
        const live = fromProcessor({ ...liveProc(), excitement: { ...EXCITEMENT, completed: true } }, 'nba');
        expect(basketballCardBody(live, 'nba').gei).toBeNull();
    });

    test('a Data API final has no excitement yet, so no GEI (as the page)', () => {
        expect(basketballCardBody(fromDataApi(api, 'nba'), 'nba').gei).toBeNull();
    });

    test('the image URL names the state; a live one carries a five-minute bucket', () => {
        const final = basketballShareImage(fromProcessor(proc, 'nba'), 'nba');
        expect(final.url).toBe(`https://gameonpaper.com/nba/game/${ID}/card.png?state=final`);
        expect(final.alt).toBe('Atlanta 95 @ Orlando 120, final: win probability chart and game excitement index');
        // the description says what the card draws: no GEI on a Data API final
        expect(basketballShareImage(fromDataApi(api, 'nba'), 'nba').alt).toBe('Atlanta 95 @ Orlando 120, final: win probability chart');
        const now = Date.UTC(2026, 10, 17, 1, 41);
        const live = basketballShareImage(fromProcessor(liveProc(), 'mbb'), 'mbb', now);
        expect(live.url).toBe(`https://gameonpaper.com/mbb/game/${ID}/card.png?state=live&v=live-${Math.floor(now / 300_000)}`);
        expect(live.alt).toMatch(/, live: win probability so far$/);
    });
});

describe('the card route', () => {
    const store = new Map<string, ArrayBuffer>();
    const puts: { key: string; ttl: number }[] = [];
    beforeEach(() => {
        up.fetched.length = 0;
        up.cardStatus = 200;
        for (const m of [up.schedule, up.rows, up.proc, up.page]) m.mockReset();
        store.clear();
        puts.length = 0;
        vi.spyOn(env.ESPN_API_CACHE, 'get').mockImplementation((async (key: string) => store.get(key) ?? null) as any);
        vi.spyOn(env.ESPN_API_CACHE, 'put').mockImplementation((async (key: string, value: ArrayBuffer, opts: any) => {
            store.set(key, value);
            puts.push({ key, ttl: opts.expirationTtl });
        }) as any);
    });
    afterEach(() => vi.restoreAllMocks());

    async function get(path: string, league: 'nba' | 'wnba' | 'mbb' | 'wbb' = 'nba') {
        const { basketballShareCardRoute } = await import('../../src/routes/basketball/shareCard');
        const url = new URL(`https://gameonpaper.com${path}`);
        const set = vi.fn();
        const res = await basketballShareCardRoute(league)({ params: { id: url.pathname.split('/').at(-2) }, url, cache: { set } } as any);
        const draw = up.fetched.find((f) => f.url.includes('/card.png'));
        return { res, set, draw, body: draw ? JSON.parse(draw.init.body) : undefined };
    }

    test('a final the Data API has not ingested: drawn from the processor payload, with the GEI, kept for a year', async () => {
        up.schedule.mockResolvedValue(null);
        up.page.mockResolvedValue(espnPage(proc));
        up.proc.mockResolvedValue(proc);
        const { res, set, draw, body } = await get(`/nba/game/${ID}/card.png?state=final`);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/png');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
        expect(set).toHaveBeenCalledWith({ maxAge: 31536000, tags: ['share-card'] });
        expect(draw!.url).toMatch(new RegExp(`/nba/${ID}/card\\.png\\?state=final$`));
        expect(draw!.init.method).toBe('POST');
        expect(body.gei).toBe(3.54);
        // the page's own processor request: a final's day-long TTL, so the page's cache entry is the one hit
        expect(up.proc).toHaveBeenCalledWith(ID, 86400, 'nba');
        expect(puts).toEqual([{ key: cardKey('nba', ID, 'final', 'full'), ttl: 31536000 }]);
    });

    test('an ingested final: drawn from the Data API, no ESPN and no processor', async () => {
        up.schedule.mockResolvedValue(api.schedule[0]);
        up.rows.mockResolvedValue(api);
        const { res, body } = await get(`/nba/game/${ID}/card.png`);
        expect(res.status).toBe(200);
        expect(body.gei).toBeNull();
        expect(body.plays.length).toBeGreaterThan(100);
        expect(up.page).not.toHaveBeenCalled();
        expect(up.proc).not.toHaveBeenCalled();
        // kept apart from a processor-drawn final, which carries a GEI the Data API page has not
        expect(puts).toEqual([{ key: cardKey('nba', ID, 'final', 'full', 'data_api'), ttl: 31536000 }]);
        expect(cardKey('nba', ID, 'final', 'full', 'data_api')).not.toBe(cardKey('nba', ID, 'final', 'full'));
    });

    const KEPT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    test('a hit is the kept card, checked after the state read (as football) and before the game is loaded', async () => {
        up.schedule.mockResolvedValue(api.schedule[0]);
        store.set(cardKey('nba', ID, 'final', 'full', 'data_api'), KEPT.buffer);
        let r = await get(`/nba/game/${ID}/card.png?state=final`);
        expect(new Uint8Array(await r.res.arrayBuffer())).toEqual(KEPT);
        expect(r.draw).toBeUndefined();
        expect(up.rows).not.toHaveBeenCalled();
        // a processor game: ESPN's page for the state, then KV, and no processor read on a hit
        up.schedule.mockResolvedValue(null);
        up.page.mockResolvedValue(espnPage(proc));
        store.set(cardKey('nba', ID, 'final', 'full'), KEPT.buffer);
        r = await get(`/nba/game/${ID}/card.png`);
        expect(new Uint8Array(await r.res.arrayBuffer())).toEqual(KEPT);
        expect(r.res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
        expect(up.proc).not.toHaveBeenCalled();
    });

    test('a kept card on a load that may not be kept (a stale ESPN payload, a failed Data API gate) is served no-store', async () => {
        up.schedule.mockResolvedValue(null);
        up.page.mockResolvedValue(espnPage(proc, { regressed: true }));
        store.set(cardKey('nba', ID, 'final', 'full'), KEPT.buffer);
        let r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        expect(r.set).toHaveBeenCalledWith(false);
        up.schedule.mockRejectedValue(new Error('data api down'));
        up.page.mockResolvedValue(espnPage(proc));
        r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
    });

    test.each(['STATUS_POSTPONED', 'STATUS_ABANDONED', 'STATUS_DELAYED'])('%s: no card, and no processor read', async (name) => {
        up.schedule.mockResolvedValue(null);
        const p = structuredClone(proc);
        p.header.competitions[0].status.type = { ...p.header.competitions[0].status.type, completed: false, state: 'post', name };
        up.page.mockResolvedValue(espnPage(p));
        const r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.status).toBe(404);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        expect(up.proc).not.toHaveBeenCalled();
    });

    test('no plays yet on a live game (the processor\'s 404) is "no card yet", not an outage', async () => {
        const p = liveProc();
        up.schedule.mockResolvedValue(null);
        up.page.mockResolvedValue(espnPage(p));
        up.proc.mockRejectedValue(new ProcessorError(404, 'no plays'));
        let r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.status).toBe(404);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        // on a final it is a broken payload, as on the page
        up.page.mockResolvedValue(espnPage(proc));
        r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.status).toBe(502);
    });

    test('the draw is bounded by a timeout', async () => {
        up.schedule.mockResolvedValue(api.schedule[0]);
        up.rows.mockResolvedValue(api);
        const { draw } = await get(`/nba/game/${ID}/card.png`);
        expect(draw!.init.signal).toBeInstanceOf(AbortSignal);
    });

    test('a live game: the state is the game\'s, not the URL\'s, and the card is kept a minute', async () => {
        const p = liveProc();
        up.schedule.mockResolvedValue(null);
        up.page.mockResolvedValue(espnPage(p));
        up.proc.mockResolvedValue(p);
        const { res, draw, body } = await get(`/wbb/game/${ID}/card.png?state=final`, 'wbb');
        expect(draw!.url).toMatch(/\/wbb\/\d+\/card\.png\?state=live$/);
        expect(body.gei).toBeNull();
        expect(body.detail).toBe('5:32 - 3rd Quarter');
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
        expect(puts).toEqual([{ key: cardKey('wbb', ID, 'live', 'full'), ttl: 60 }]);
    });

    test('never kept: a processor payload still live after ESPN called the game, and a stale ESPN payload', async () => {
        up.schedule.mockResolvedValue(null);
        up.page.mockResolvedValue(espnPage(proc));
        up.proc.mockResolvedValue(liveProc());
        let r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        expect(r.set).toHaveBeenCalledWith(false);
        up.page.mockResolvedValue(espnPage(proc, { regressed: true }));
        up.proc.mockResolvedValue(proc);
        r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        expect(puts).toEqual([]);
    });

    test('before the tip there is no card; a bad request is a 400; a failure is a 502; none cached', async () => {
        up.schedule.mockResolvedValue(null);
        const pre = structuredClone(proc);
        pre.header.competitions[0].status.type = { ...pre.header.competitions[0].status.type, completed: false, state: 'pre', name: 'STATUS_SCHEDULED' };
        up.page.mockResolvedValue(espnPage(pre));
        let r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.status).toBe(404);
        expect(r.draw).toBeUndefined();
        for (const path of ['/nba/game/12/card.png', `/nba/game/${ID}/card.png?state=pre`]) {
            r = await get(path);
            expect(r.res.status).toBe(400);
        }
        up.page.mockResolvedValue(espnPage(proc));
        up.proc.mockRejectedValue(new ProcessorError(502, 'down'));
        r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.status).toBe(502);
        up.proc.mockResolvedValue(proc);
        up.cardStatus = 500;
        r = await get(`/nba/game/${ID}/card.png`);
        expect(r.res.status).toBe(502);
        expect(r.res.headers.get('Cache-Control')).toBe('no-store');
        expect(puts).toEqual([]);
    });
});
