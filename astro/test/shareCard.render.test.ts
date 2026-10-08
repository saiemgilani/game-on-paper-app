import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { cardCacheControl, cardLogoUrl, cardState, shareTags, type ShareTagGame } from '../src/utils/shareTags';
import { SPECIAL_IMAGES } from '../src/utils/constants';

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
    guarded: null as any,
}));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: any) => {
        const u = String(url);
        upstream.fetched.push({ url: u, init });
        if (u.includes(`/cfb/${GAME_ID}/process`)) return new Response(apiPayload, { status: 200, headers: { 'content-type': 'application/json' } });
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
        expect(api!.init.cf.cacheTtlByStatus['200-299']).toBe(ttl);
        expect(api!.init.cf.cacheKey).toContain(`state=${state}&variant=full`);
        // each side's art rides along to the API, never into the cache key or the public URL
        const q = new URL(api!.url).searchParams;
        const ids = Object.fromEntries(header(espnState).competitions[0].competitors.map((c: any) => [c.homeAway, c.team.id]));
        expect(q.get('home_logo')).toBe(`https://a.espncdn.com/i/teamlogos/ncaa/500/${ids.home}.png`);
        expect(q.get('away_logo')).toBe(`https://a.espncdn.com/i/teamlogos/ncaa/500/${ids.away}.png`);
        expect(api!.init.cf.cacheKey).not.toContain('logo');
        expect(set).toHaveBeenCalledWith({ maxAge: ttl, tags: ['share-card'] });
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
