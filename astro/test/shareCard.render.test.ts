import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { cardCacheControl, cardLogoUrl, cardState, shareTags, type ShareTagGame } from '../src/utils/shareTags';
import { SPECIAL_IMAGES } from '../src/utils/constants';
import { getGameCacheConfig } from '../src/utils/config';

// 'share-card': game links preview with the API's card (python/share_card.py), and
// ?spoilers=off previews without the score. Real fixtures: the /process payload of
// CMU 30 at OKST 27 (2016, final) and the ESPN pregame payloads of PUR at UCLA (2026).
const GAME_ID = 400869270;
const PREGAME_ID = 401858458;
const gz = (f: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${f}`, import.meta.url))).toString());
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/usage-cfb-400869270.json.gz', import.meta.url))).toString();
const pregame = gz('pregame-401858458-cfb.json.gz') as { playbyplay: any; summary: any };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// every upstream the page and the card route reach, answered from the fixtures
const upstream = vi.hoisted(() => ({
    fetched: [] as { url: string; init?: any }[],
    cardStatus: 200,
    processStatus: 200,
    processBody: null as string | null, // a payload a test pins
    autoBody: null as string | null, // else: the final game, in whatever state ESPN's header says (what the page's cache holds)
    guarded: null as any,
}));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: any) => {
        const u = String(url);
        upstream.fetched.push({ url: u, init });
        if (u.includes(`/cfb/${GAME_ID}/process`)) return new Response(upstream.processStatus === 200 ? (upstream.processBody ?? upstream.autoBody ?? apiPayload) : 'no', { status: upstream.processStatus, headers: { 'content-type': 'application/json' } });
        if (u.includes('/card.png')) return new Response(upstream.cardStatus === 200 ? PNG : 'no', { status: upstream.cardStatus });
        throw new Error(`unexpected fetch in test: ${u}`);
    },
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => [],
    // UCLA (26) a little better than Purdue (2509) on net adjusted EPA/play
    retrieveTeamSummaries: async ({ team_id }: { team_id: number }) => [{ team_id, net_adj_epa: team_id === 26 ? 0.12 : 0.02 }],
    retrieveTeamSeasonInformation: async () => ({ team: null, events: [] }),
    retrieveMatchupHistory: async () => [],
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveGameSummary: async () => pregame.summary,
    retrieveGamePageGuarded: async () => upstream.guarded,
}));

let container: AstroContainer;
let game: any;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    const { retrieveProcessedGame } = await import('../src/resources/python');
    game = await retrieveProcessedGame(GAME_ID, 30);
}, 60_000);

const TWINS = {
    v2: () => import('../src/components/game/GamePage.astro'),
    classic: () => import('../src/components/game/classic/GamePage.astro'),
} as const;
type Twin = keyof typeof TWINS;

const head = (html: string) => html.match(/<head>[\s\S]*?<\/head>/)![0];
const meta = (html: string, key: string) => head(html).match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1]?.replace(/&amp;/g, '&');
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

function live(g: any) {
    const out = structuredClone(g);
    out.header.competitions[0].status.type = { ...out.header.competitions[0].status.type, completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' };
    return out;
}

async function renderGame(twin: Twin, on: boolean, { query = '', g = game }: { query?: string; g?: any } = {}) {
    const { default: Page } = await TWINS[twin]();
    return container.renderToString(Page, {
        props: { id: GAME_ID, game: g, league: 'cfb' },
        request: new Request(`https://gameonpaper.com/game/${GAME_ID}${query}`),
        locals: { league: 'cfb', flagOverrides: { 'share-card': on } } as any,
    });
}

async function renderPregame(on: boolean, query = '') {
    const { default: PreGamePage } = await import('../src/components/game/PreGamePage.astro');
    return container.renderToString(PreGamePage, {
        props: { id: PREGAME_ID, espnGame: pregame.playbyplay, league: 'cfb' },
        request: new Request(`https://gameonpaper.com/game/${PREGAME_ID}${query}`),
        locals: { league: 'cfb', flagOverrides: { 'share-card': on } } as any,
    });
}

const SPEC: ShareTagGame = {
    id: GAME_ID, league: 'cfb', state: 'final', away: 'Central Michigan', home: 'Oklahoma State',
    awayScore: '30', homeScore: '27', date: '2016-09-10T16:00Z', season: 2016, week: 2,
    title: 'Central Michigan 30, Oklahoma State 27 | Week 2 2016 EPA & advanced box score | Game on Paper',
    description: 'Central Michigan 30, Oklahoma State 27 on Sep 10, 2016: ...',
};
// a preview must not carry the result: no score digits, no "<n> @ ... <n>"
const scoreFree = (s: string | undefined) => {
    expect(s).toBeTruthy();
    expect(s).not.toMatch(/\b(30|27)\b/);
    expect(s).not.toMatch(/\d+ @ .* \d+/);
};

describe('shareTags', () => {
    test('a final card is immutable and named by state and variant', () => {
        const t = shareTags(SPEC, { spoilerFree: false });
        expect(t.image).toBe(`https://gameonpaper.com/game/${GAME_ID}/card.png?state=final&variant=full`);
        expect(t.url).toBe(`https://gameonpaper.com/game/${GAME_ID}`);
        expect(t.jsonLd).toBe(true);
        expect(t.title).toBe(SPEC.title);
        expect(t.description).toBe(SPEC.description);
        expect(cardCacheControl('final')).toBe('public, max-age=31536000, immutable');
    });

    test('a live card carries a five-minute bucket and a one-minute cache', () => {
        const now = Date.UTC(2026, 9, 3, 1, 41);
        const t = shareTags({ ...SPEC, state: 'live', league: 'nfl' }, { spoilerFree: false, now });
        expect(t.image).toBe(`https://gameonpaper.com/nfl/game/${GAME_ID}/card.png?state=live&variant=full&v=live-${Math.floor(now / 300_000)}`);
        // the bucket moves every five minutes, not every render
        expect(shareTags({ ...SPEC, state: 'live' }, { spoilerFree: false, now: now + 60_000 }).image).toContain(`v=live-${Math.floor(now / 300_000)}`);
        expect(cardCacheControl('live')).toBe('public, max-age=60');
        expect(cardCacheControl('pre')).toBe('public, max-age=3600');
    });

    test('spoiler-free: title, description and alt say the matchup and date, never the score', () => {
        for (const state of ['final', 'live'] as const) {
            const t = shareTags({ ...SPEC, state }, { spoilerFree: true });
            expect(t.image).toContain('variant=spoilerfree');
            // its own og:url: a platform keying previews on og:url must not merge it with the scored link
            expect(t.url).toBe(`https://gameonpaper.com/game/${GAME_ID}?spoilers=off`);
            expect(t.jsonLd).toBe(false);
            expect(t.title).toBe('Central Michigan @ Oklahoma State / Week 2 2016 / Game on Paper');
            expect(t.description).toMatch(state === 'final' ? /^Final on Sep 10, 2016\./ : /^Live on Sep 10, 2016\./);
            for (const s of [t.title, t.description, t.imageAlt]) scoreFree(s);
        }
    });

    test('card art: GOP\'s own where the site overrides ESPN\'s, else ESPN\'s light logo', () => {
        // the overrides DarkModeLogos applies, read from the one map (UGA and GT today)
        expect(Object.keys(SPECIAL_IMAGES).sort()).toEqual(['59', '61']);
        expect(cardLogoUrl('cfb', 61)).toBe('https://gameonpaper.com/assets/img/ennui-uga.png');
        expect(cardLogoUrl('cfb', '59')).toBe('https://gameonpaper.com/assets/img/gt-old-gold.png');
        expect(cardLogoUrl('cfb', 197)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/197.png');
        expect(cardLogoUrl('nfl', 30)).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/30.png');
    });

    test('the state follows ESPN', () => {
        expect(cardState({ type: { completed: true, state: 'post' } } as any)).toBe('final');
        expect(cardState({ type: { completed: false, state: 'in' } } as any)).toBe('live');
        expect(cardState({ type: { completed: false, state: 'pre' } } as any)).toBe('pre');
        // postponed or canceled: nothing was scored, so it is still a pregame card
        expect(cardState({ type: { completed: false, state: 'post' } } as any)).toBe('pre');
    });
});

describe('share-card off: every head is what main renders', () => {
    // sha256 (16 hex) of each <head> rendered from origin/main b8b8eaad's
    // components with these fixtures, before 'share-card' existed. Delete this block
    // when the flag is promoted.
    const GOLDEN = { v2: '02ff6811e8e71526', classic: '02ff6811e8e71526', pregame: '6b43f22e0c60e419' };

    test.each(Object.keys(TWINS) as Twin[])('%s', async (twin) => {
        const html = await renderGame(twin, false);
        expect(meta(html, 'og:image')).toBe(`https://s.espncdn.com/stitcher/sports/football/college-football/events/${GAME_ID}.png?templateId=espn.com.share.1`);
        expect(meta(html, 'og:image:width')).toBe('400');
        expect(meta(html, 'twitter:card')).toBe('summary');
        expect(head(html)).not.toContain('og:image:alt');
        if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${twin} ${sha(head(html))}`);
        expect(sha(head(html))).toBe(GOLDEN[twin]);
        // ?spoilers=off is ignored
        expect(head(await renderGame(twin, false, { query: '?spoilers=off' }))).toBe(head(html));
        // and no Share button
        expect(html).not.toContain('ShareButton');
    }, 60_000);

    test('pregame', async () => {
        const html = await renderPregame(false);
        expect(meta(html, 'og:image')).toContain('s.espncdn.com/stitcher');
        expect(meta(html, 'twitter:card')).toBe('summary');
        if (process.env.PRINT_GOLDEN) console.log(`GOLDEN pregame ${sha(head(html))}`);
        expect(sha(head(html))).toBe(GOLDEN.pregame);
        expect(head(await renderPregame(false, '?spoilers=off'))).toBe(head(html));
    }, 60_000);
});

describe('share-card on: the card for the game state', () => {
    test.each(Object.keys(TWINS) as Twin[])('%s, final', async (twin) => {
        const html = await renderGame(twin, true);
        expect(meta(html, 'og:image')).toBe(`https://gameonpaper.com/game/${GAME_ID}/card.png?state=final&variant=full`);
        expect(meta(html, 'twitter:image')).toBe(meta(html, 'og:image'));
        expect(meta(html, 'og:image:width')).toBe('1200');
        expect(meta(html, 'og:image:height')).toBe('630');
        expect(meta(html, 'twitter:card')).toBe('summary_large_image');
        expect(meta(html, 'og:image:alt')).toBe('Central Michigan 30 @ Oklahoma State 27, final: win probability chart and Deserved Win %');
        // the full variant keeps today's title, address and JSON-LD
        expect(meta(html, 'og:title')).toMatch(/^Central Michigan 30, Oklahoma State 27 \|/);
        expect(meta(html, 'og:url')).toBe(`https://gameonpaper.com/game/${GAME_ID}`);
        expect(head(html)).toContain('application/ld+json');
    }, 60_000);

    test.each(Object.keys(TWINS) as Twin[])('%s, live', async (twin) => {
        const html = await renderGame(twin, true, { g: live(game) });
        expect(meta(html, 'og:image')).toMatch(new RegExp(`/game/${GAME_ID}/card\\.png\\?state=live&variant=full&v=live-\\d+$`));
    }, 60_000);

    test('pregame', async () => {
        const html = await renderPregame(true);
        expect(meta(html, 'og:image')).toBe(`https://gameonpaper.com/game/${PREGAME_ID}/card.png?state=pre&variant=full`);
        expect(meta(html, 'twitter:card')).toBe('summary_large_image');
        expect(meta(html, 'og:title')).toMatch(/^Purdue vs UCLA \|/); // today's pregame title
        // both header twins get the button
        expect(html.match(/ShareButton/g)?.length).toBeGreaterThanOrEqual(2);
    }, 60_000);

    test.each(Object.keys(TWINS) as Twin[])('%s, ?spoilers=off: the preview hides the score, the page does not', async (twin) => {
        const html = await renderGame(twin, true, { query: '?spoilers=off' });
        expect(meta(html, 'og:image')).toBe(`https://gameonpaper.com/game/${GAME_ID}/card.png?state=final&variant=spoilerfree`);
        for (const key of ['og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'description', 'title']) scoreFree(meta(html, key));
        for (const key of ['og:url', 'twitter:url']) expect(meta(html, key)).toBe(`https://gameonpaper.com/game/${GAME_ID}?spoilers=off`);
        // the JSON-LD names the result, so the spoiler-free head leaves it out; canonical stays the game
        expect(head(html)).not.toContain('application/ld+json');
        expect(head(html)).toContain(`<link rel="canonical" href="https://gameonpaper.com/game/${GAME_ID}">`);
        expect(head(html).match(/<title>([^<]*)<\/title>/)![1]).toBe('Central Michigan @ Oklahoma State / Week 2 2016 / Game on Paper');
        // the body is unchanged: the header still says the score
        const body = html.slice(html.indexOf('<body'));
        expect(body).toMatch(/Central Michigan[\s\S]{0,400}30[\s\S]{0,400}Oklahoma State[\s\S]{0,400}27/);
        const plain = await renderGame(twin, true);
        const uid = (s: string) => s.replace(/\suid="[^"]*"/g, '');
        expect(uid(body)).toBe(uid(plain.slice(plain.indexOf('<body'))));
    }, 60_000);
});

describe('Share button beside Watch', () => {
    async function header(on: boolean) {
        const { default: GameHeader } = await import('../src/components/game/GameHeader.astro');
        return container.renderToString(GameHeader, {
            props: { game },
            locals: { league: 'cfb', flagOverrides: { 'share-card': on } } as any,
        });
    }

    test('on: a desktop icon and a phone "Share", each a right-aligned menu with both links', async () => {
        const html = await header(true);
        const islands = [...html.matchAll(/<astro-island\b[^>]*ShareButton[^>]*>[\s\S]*?<\/astro-island>/g)].map((m) => m[0]);
        expect(islands).toHaveLength(2);
        for (const island of islands) {
            const props = island.match(/\sprops="([^"]*)"/)![1].replace(/&quot;/g, '"');
            expect(props).toContain(`"url":[0,"https://gameonpaper.com/game/${GAME_ID}"]`);
            expect(props).toContain(`"spoilerFreeUrl":[0,"https://gameonpaper.com/game/${GAME_ID}?spoilers=off"]`);
            // the approved design: the menu opens downward from the button's right edge
            expect(island).toMatch(/class="dropdown-menu dropdown-menu-end[^"]*"[^>]*data-bs-popper="static"/);
            expect(island).toContain('Share link');
            expect(island).toContain('Share without the score');
            expect(island).toContain('Preview hides the score');
        }
        // desktop: the icon alone in the right column; phone: "Share" in the row under the title
        // (Astro puts its client:load bootstrap <script> before the first island)
        const after = (cls: string) => html.slice(html.indexOf(`class="${cls}"`)).replace(/<script>[\s\S]*?<\/script>/g, '').slice(0, 1500);
        expect(after('col-2 d-flex justify-content-end align-items-center gap-2')).toMatch(/^[^>]*><astro-island\b[^>]*ShareButton[\s\S]*?<i class="bi-share"><\/i><\/button>/);
        expect(after('d-flex align-items-center gap-2')).toMatch(/^[^>]*><astro-island\b[^>]*ShareButton[\s\S]*?<i class="bi-share"><\/i> Share<\/button>/);
    });

    test('off: no button and the header markup of today', async () => {
        const html = await header(false);
        expect(html).not.toContain('ShareButton');
        expect(html).toContain('<div class="col-2 d-flex justify-content-end align-items-center">');
        expect(html).not.toContain('gap-2');
    });
});

describe('the card route', () => {
    const header = (state: 'pre' | 'in' | 'post', completed = state === 'post') => {
        const h = structuredClone(state === 'pre' ? pregame.playbyplay.gamepackageJSON.header : game.header);
        h.competitions[0].status.type = { ...h.competitions[0].status.type, state, completed };
        return h;
    };
    async function get(path: string, h: any, { regressed = false } = {}) {
        upstream.fetched.length = 0;
        const processed = structuredClone(game);
        if (h) processed.header.competitions[0].status = h.competitions[0].status;
        upstream.autoBody = JSON.stringify(processed);
        upstream.guarded = h ? { page: { gamepackageJSON: { header: h } }, regressed, reason: null } : { page: null, regressed: false, reason: null };
        const { shareCardRoute } = await import('../src/routes/shareCard');
        const url = new URL(`https://gameonpaper.com${path}`);
        const set = vi.fn();
        const res = await shareCardRoute(url.pathname.startsWith('/nfl') ? 'nfl' : 'cfb')({ params: { id: url.pathname.split('/').at(-2) }, url, cache: { set } } as any);
        const api = upstream.fetched.find((f) => f.url.includes('/card.png'));
        return { res, api, set };
    }

    test.each([
        ['post', 'final', 'public, max-age=31536000, immutable', 31536000],
        ['in', 'live', 'public, max-age=60', 60],
        ['pre', 'pre', 'public, max-age=3600', 3600],
    ] as const)('ESPN %s: the %s card, cached for its state', async (espnState, state, cacheControl, ttl) => {
        const id = espnState === 'pre' ? PREGAME_ID : GAME_ID;
        const { res, api, set } = await get(`/game/${id}/card.png?state=${state}&variant=full`, header(espnState));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/png');
        expect(res.headers.get('cache-control')).toBe(cacheControl);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
        expect(api!.url).toContain(`/cfb/${id}/card.png?state=${state}&variant=full`);
        expect(api!.init.method).toBe(state === 'pre' ? undefined : 'POST');
        // a pregame card is the API's cacheable GET; a played game's POST has no edge cache, the route's `cache.set` below is its layer
        if (state === 'pre') {
            expect(api!.init.cf.cacheTtlByStatus['200-299']).toBe(ttl);
            expect(api!.init.cf.cacheKey).toContain(`state=${state}&variant=full`);
        }
        // each side's art rides along to the API, never into the cache key or the public URL
        const q = new URL(api!.url).searchParams;
        const ids = Object.fromEntries(header(espnState).competitions[0].competitors.map((c: any) => [c.homeAway, c.team.id]));
        expect(q.get('home_logo')).toBe(`https://a.espncdn.com/i/teamlogos/ncaa/500/${ids.home}.png`);
        expect(q.get('away_logo')).toBe(`https://a.espncdn.com/i/teamlogos/ncaa/500/${ids.away}.png`);
        if (state === 'pre') expect(api!.init.cf.cacheKey).not.toContain('logo');
        expect(set).toHaveBeenCalledWith({ maxAge: ttl, tags: ['share-card'] });
    });

    describe('a played card is drawn from the game the page already processed', () => {
        const PLAY_KEYS = ['scrimmage_play', 'winProbability', 'period', 'pos_team', 'homeScore', 'awayScore', 'scoringPlay'];
        const processed = () => upstream.fetched.find((f) => f.url.includes('/process'));

        test.each(['full', 'spoilerfree'])('%s: the API gets the page\'s plays in the body, not a reason to rerun the pipeline', async (variant) => {
            const h = header('post');
            const { api } = await get(`/game/${GAME_ID}/card.png?state=final&variant=${variant}`, h);
            const body = JSON.parse(api!.init.body);
            expect(body.plays).toHaveLength(game.plays.length);
            expect(Object.keys(body.plays[0]).every((k) => PLAY_KEYS.includes(k))).toBe(true);
            expect(body.plays.map((p: any) => p.winProbability?.before)).toEqual(game.plays.map((p: any) => p.winProbability?.before));
            expect(body.paperIndex).toEqual({ homeShare: game.paperIndex.homeShare });
            expect(api!.init.headers['Content-Type']).toBe('application/json');
        });

        test('it asks for the page\'s own /process, under the page\'s cache TTL, so the page\'s cache entry is the one hit', async () => {
            const h = header('in');
            await get(`/game/${GAME_ID}/card.png?state=live&variant=full`, h);
            const ttl = getGameCacheConfig(h.competitions[0].date, h.competitions[0].status).maxAge || 30;
            expect(processed()!.url).toMatch(new RegExp(`/cfb/${GAME_ID}/process$`));
            expect(processed()!.init.cf.cacheTtlByStatus['200-299']).toBe(ttl);
        });

        test('a pregame card has no plays and never touches /process', async () => {
            const { api } = await get(`/game/${PREGAME_ID}/card.png?state=pre&variant=full`, header('pre'));
            expect(processed()).toBeUndefined();
            expect(api!.init.body).toBeUndefined();
        });

        test('no processed game: the card is drawn without the chart and kept for no time', async () => {
            upstream.processStatus = 404;
            try {
                const { res, api, set } = await get(`/game/${GAME_ID}/card.png?state=final&variant=full`, header('post'));
                expect(res.status).toBe(200);
                expect(JSON.parse(api!.init.body)).toEqual({});
                expect(res.headers.get('cache-control')).toBe('no-store');
                expect(set).toHaveBeenCalledWith(false);
            } finally {
                upstream.processStatus = 200;
            }
        });

        test('the page\'s cached game lags a transition: drawn, but never kept as a year-long final', async () => {
            const lagging = structuredClone(game);
            lagging.header.competitions[0].status.type = { ...lagging.header.competitions[0].status.type, completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' };
            upstream.processBody = JSON.stringify(lagging);
            try {
                const { res, set } = await get(`/game/${GAME_ID}/card.png?state=final&variant=full`, header('post'));
                expect(res.status).toBe(200);
                expect(res.headers.get('cache-control')).toBe('no-store');
                expect(set).toHaveBeenCalledWith(false);
            } finally {
                upstream.processBody = null;
            }
        });
    });

    describe('KV keeps played cards: the page load writes them, the route reads them first', () => {
        const store = new Map<string, ArrayBuffer>();
        const puts: { key: string; ttl: number }[] = [];
        const KEPT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
        const cardFetches = () => upstream.fetched.filter((f) => f.url.includes('/card.png'));
        beforeEach(() => {
            store.clear();
            puts.length = 0;
            vi.spyOn(env.ESPN_API_CACHE, 'get').mockImplementation((async (key: string) => store.get(key) ?? null) as any);
            vi.spyOn(env.ESPN_API_CACHE, 'put').mockImplementation((async (key: string, value: ArrayBuffer, opts: any) => {
                store.set(key, value);
                puts.push({ key, ttl: opts.expirationTtl });
            }) as any);
        });
        afterEach(() => vi.restoreAllMocks());

        test.each([['post', 'final', 31536000], ['in', 'live', 60]] as const)('a miss on a %s game draws the %s card and writes it back for its state', async (espnState, state, ttl) => {
            const { cardKey } = await import('../src/routes/shareCard');
            const { res, api } = await get(`/game/${GAME_ID}/card.png?state=${state}&variant=full`, header(espnState));
            expect(api).toBeDefined();
            expect(res.status).toBe(200);
            const key = cardKey('cfb', String(GAME_ID), state, 'full');
            expect(puts).toEqual([{ key, ttl }]);
            expect(new Uint8Array(store.get(key)!)).toEqual(PNG);
        });

        test('a hit is the kept card: no /process, no API draw, cached for its state', async () => {
            const { cardKey } = await import('../src/routes/shareCard');
            store.set(cardKey('cfb', String(GAME_ID), 'final', 'spoilerfree'), KEPT.buffer);
            const { res, api, set } = await get(`/game/${GAME_ID}/card.png?state=final&variant=spoilerfree`, header('post'));
            expect(new Uint8Array(await res.arrayBuffer())).toEqual(KEPT);
            expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
            expect(set).toHaveBeenCalledWith({ maxAge: 31536000, tags: ['share-card'] });
            expect(api).toBeUndefined();
            expect(upstream.fetched.some((f) => f.url.includes('/process'))).toBe(false);
            expect(puts).toEqual([]);
        });

        test('KV is keyed per league, game, state, variant and deploy', async () => {
            const { cardKey } = await import('../src/routes/shareCard');
            const { APP_VERSION } = await import('../src/resources/python');
            expect(cardKey('cfb', 1, 'final', 'full')).toBe(`card:1:final:full:${APP_VERSION}`);
            expect(cardKey('nfl', 1, 'live', 'spoilerfree')).toBe(`card:nfl:1:live:spoilerfree:${APP_VERSION}`);
        });

        test('a card not kept is not written: a lagging /process, a regressed ESPN payload, a pregame card', async () => {
            const lagging = structuredClone(game);
            lagging.header.competitions[0].status.type = { ...lagging.header.competitions[0].status.type, completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' };
            upstream.processBody = JSON.stringify(lagging);
            try {
                await get(`/game/${GAME_ID}/card.png?state=final&variant=full`, header('post'));
            } finally {
                upstream.processBody = null;
            }
            await get(`/game/${GAME_ID}/card.png?state=final&variant=full`, header('post'), { regressed: true });
            await get(`/game/${PREGAME_ID}/card.png?state=pre&variant=full`, header('pre'));
            expect(puts).toEqual([]);
        });

        test('a KV failure fails open: the card is drawn', async () => {
            vi.mocked(env.ESPN_API_CACHE.get).mockRejectedValue(new Error('kv down'));
            const { res, api } = await get(`/game/${GAME_ID}/card.png?state=final&variant=full`, header('post'));
            expect(res.status).toBe(200);
            expect(api).toBeDefined();
        });

        // the game page's data step (routes/game.ts), as the page calls it
        async function loadPage(h: any, on: boolean) {
            upstream.fetched.length = 0;
            const processed = structuredClone(game);
            processed.header.competitions[0].status = h.competitions[0].status;
            upstream.autoBody = JSON.stringify(processed);
            upstream.guarded = { page: { gamepackageJSON: { header: h } }, regressed: false, reason: null };
            const waitUntil = vi.fn();
            const { loadGameRoute } = await import('../src/routes/game');
            await loadGameRoute({
                params: { id: String(GAME_ID) }, url: new URL(`https://gameonpaper.com/game/${GAME_ID}`),
                locals: { flagOverrides: { 'share-card': on }, cfContext: { waitUntil } },
                cache: { set: vi.fn() }, response: { headers: new Headers() },
            } as any, 'cfb');
            await Promise.all(waitUntil.mock.calls.map(([p]) => p));
            return waitUntil;
        }

        test('on: a page load keeps both variants of the played card, after the page is sent, and a second load draws nothing', async () => {
            const { cardKey } = await import('../src/routes/shareCard');
            const waitUntil = await loadPage(header('post'), true);
            expect(waitUntil).toHaveBeenCalledTimes(1);
            expect(cardFetches().map((f) => f.init.method)).toEqual(['POST', 'POST']);
            expect(JSON.parse(cardFetches()[0].init.body).plays).toHaveLength(game.plays.length);
            expect([...puts].sort((a, b) => a.key.localeCompare(b.key))).toEqual([
                { key: cardKey('cfb', String(GAME_ID), 'final', 'full'), ttl: 31536000 },
                { key: cardKey('cfb', String(GAME_ID), 'final', 'spoilerfree'), ttl: 31536000 },
            ]);
            await loadPage(header('post'), true);
            expect(cardFetches()).toEqual([]);
            expect(puts).toHaveLength(2);
            // and the route then serves the kept card without drawing
            const { api } = await get(`/game/${GAME_ID}/card.png?state=final&variant=full`, header('post'));
            expect(api).toBeUndefined();
        });

        test('on: a live game keeps a one-minute card; a /process lagging ESPN keeps none', async () => {
            await loadPage(header('in'), true);
            expect(puts.map((p) => p.ttl)).toEqual([60, 60]);
            puts.length = 0;
            store.clear();
            const lagging = structuredClone(game);
            lagging.header.competitions[0].status.type = { ...lagging.header.competitions[0].status.type, completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' };
            upstream.processBody = JSON.stringify(lagging);
            try {
                await loadPage(header('post'), true);
            } finally {
                upstream.processBody = null;
            }
            expect(puts).toEqual([]);
            expect(cardFetches()).toEqual([]);
        });

        test('off: a page load never draws or writes a card', async () => {
            const waitUntil = await loadPage(header('post'), false);
            expect(waitUntil).not.toHaveBeenCalled();
            expect(cardFetches()).toEqual([]);
            expect(puts).toEqual([]);
        });
    });

    test('the pregame card carries the projection the pregame page shows', async () => {
        const { api } = await get(`/game/${PREGAME_ID}/card.png`, header('pre'));
        const q = new URL(api!.url).searchParams;
        expect(Number(q.get('proj_margin'))).toBeGreaterThan(0); // UCLA, at home and better on paper
        expect(Number(q.get('proj_wp'))).toBeGreaterThan(0.5);
    });

    test('the state is ESPN\'s, not the URL\'s: a live game asked for as final is a live card, cached a minute', async () => {
        const { res, api } = await get(`/game/${GAME_ID}/card.png?state=final&variant=spoilerfree`, header('in'));
        expect(res.headers.get('cache-control')).toBe('public, max-age=60');
        expect(api!.url).toContain('state=live&variant=spoilerfree');
    });

    test('UGA and GT get the art the site shows, not ESPN\'s', async () => {
        const h = header('post');
        const comps = h.competitions[0].competitors;
        comps.find((c: any) => c.homeAway === 'home').team.id = '61';
        comps.find((c: any) => c.homeAway === 'away').team.id = '59';
        const { api } = await get(`/game/${GAME_ID}/card.png?state=final&variant=full`, h);
        const q = new URL(api!.url).searchParams;
        expect(q.get('home_logo')).toBe('https://gameonpaper.com/assets/img/ennui-uga.png');
        expect(q.get('away_logo')).toBe('https://gameonpaper.com/assets/img/gt-old-gold.png');
    });

    test('nfl reaches the nfl API route', async () => {
        const { api } = await get(`/nfl/game/${GAME_ID}/card.png?state=final&variant=full`, header('post'));
        expect(api!.url).toContain(`/nfl/${GAME_ID}/card.png`);
        expect(new URL(api!.url).searchParams.get('home_logo')).toMatch(/^https:\/\/a\.espncdn\.com\/i\/teamlogos\/nfl\/500\/\d+\.png$/);
    });

    test('an ESPN payload older than one already shown is drawn but never cached', async () => {
        const { res, set } = await get(`/game/${GAME_ID}/card.png?state=final&variant=full`, header('post'), { regressed: true });
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(set).toHaveBeenCalledWith(false);
    });

    test.each([
        [`/game/${GAME_ID}/card.png?state=halftime`, 400],
        [`/game/${GAME_ID}/card.png?variant=blurred`, 400],
        ['/game/abc/card.png', 400],
    ])('%s is a %i', async (path, status) => {
        const { res, api } = await get(path, header('post'));
        expect(res.status).toBe(status);
        expect(api).toBeUndefined();
    });

    test('an unknown game is a 404 and an API failure a 502, neither cached', async () => {
        const missing = await get(`/game/1/card.png?state=final`, null);
        expect(missing.res.status).toBe(404);
        expect(missing.res.headers.get('cache-control')).toBe('no-store');
        upstream.cardStatus = 500;
        try {
            const failed = await get(`/game/${GAME_ID}/card.png?state=final`, header('post'));
            expect(failed.res.status).toBe(502);
            expect(failed.res.headers.get('cache-control')).toBe('no-store');
        } finally {
            upstream.cardStatus = 200;
        }
    });
});
