// BB-G18: the pregame projection behind 'bball-pregame-projection' (the bracketology bracket keeps its bid chances). The card
// reads the game's `{lg}.rated_priors` row as published (sdv-py#1193, sdv-db#229); the site computes nothing. The rows are
// real Data API reads (fixtures/README.md: pregame-projection.json.gz). The read (one season- and game-filtered row), the
// route gates and the template. Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// an unmocked read would go to the Data API with the vitest config's dummy SDV_AUTH_TOKEN (a 429 lockout for this IP)
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const FX = gz('pregame-projection');
const NBA_PRESEASON = JSON.parse(readFileSync(new URL('./fixtures/nba/pregame_401898403.json', import.meta.url)).toString()); // CLE at ORL, a preseason game

const api = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, calls: [] as { schema: string; table: string; query: Record<string, string> }[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        const key = `${source.schema}.${query.season}.${query.game_id}`;
        if (table !== 'rated_priors' || !(key in api.rows)) throw new Error(`unexpected read ${table} ${key}`);
        return api.rows[key];
    },
}));
const espn = vi.hoisted(() => ({ page: null as any }));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveGamePageGuarded: async () => ({ page: espn.page, regressed: false, fetchFailed: false }),
    retrieveGameSummary: async () => null,
}));
vi.mock('../src/resources/nbaGames', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaGames')>()),
    retrieveNbaSchedule: async () => null, // not ingested: the route goes to ESPN, which says scheduled
}));
vi.mock('../src/resources/nbaShots', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaShots')>()), retrieveSeasonPlayerRows: async () => [] }));
// the bracketology snapshot: the 2025-26 men's final day (the current season has none, so the page falls back to it)
vi.mock('../src/resources/bracketology', async (orig) => ({
    ...(await orig<typeof import('../src/resources/bracketology')>()),
    retrieveLatestSnapshot: async (_l: string, season?: number) => (season === 2027 ? null : gz('bracketology-mbb-2026').snapshot),
    retrieveSnapshot: async () => { const f = gz('bracketology-mbb-2026'); return { sims: f.sims, bracket: f.bracket, resume: f.resume }; },
}));

import NbaPreGamePage from '../src/components/nba/game/NbaPreGamePage.astro';
import NbaGameRoute from '../src/components/routes/NbaGameRoute.astro';
import BracketologyRoute from '../src/components/routes/BracketologyRoute.astro';
import { prepareBasketballGame, type PregameProjection } from '../src/routes/basketball/game';
import { prepareBracketology } from '../src/routes/basketball/bracketology';
import { retrieveRatedPrior } from '../src/resources/pregameProjection';
import { FLAGS } from '../src/utils/features';

const RP: Record<string, any[]> = FX.rated_priors;
beforeEach(() => { api.rows = { ...RP }; api.calls = []; api.fail = false; espn.page = null; });
const row = (key: string) => RP[key][0];

describe('retrieveRatedPrior: one season- and game-filtered row of the league games schema', () => {
    test.each([
        ['mbb', 2027, '401909524', 'mbb'],
        ['wbb', 2027, '401911739', 'wbb'],
        ['nba', 2027, '401909994', 'nba'],
        ['wnba', 2026, '401856990', 'wnba'],
    ] as const)('%s %s %s', async (league, season, id, schema) => {
        const r = await retrieveRatedPrior(league, season, id);
        expect(api.calls).toEqual([{ schema, table: 'rated_priors', query: { season: String(season), game_id: id, limit: '1' } }]);
        expect(r).toEqual(row(`${schema}.${season}.${id}`));
    });
    test('no row (a preseason game): null', async () => expect(await retrieveRatedPrior('nba', 2027, '401898403')).toBeNull());
    test('strict: an outage throws, never a game with no row', async () => {
        api.fail = true;
        await expect(retrieveRatedPrior('wbb', 2027, '401911739')).rejects.toThrow('down');
    });
});

function fakeAstro(league: string, id: string, locals: Record<string, unknown>, search = '') {
    const cache: unknown[] = [];
    const headers = new Headers();
    const astro = { params: { id }, url: new URL(`https://gameonpaper.com/${league}/game/${id}${search}`), locals: { ...locals }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any;
    return { astro, cache, headers };
}
const ON = { preview: true };
const OFF = { preview: true, flagOverrides: { 'bball-pregame-projection': false } };
const prep = async (league: 'mbb' | 'wbb' | 'nba', id: string, page: any, locals = ON) => {
    espn.page = page;
    const f = fakeAstro(league, id, locals);
    return { r: (await prepareBasketballGame(f.astro, league)) as any, ...f };
};

describe('prepareBasketballGame: the pregame card', () => {
    test('the flag ships as preview', () => expect(FLAGS['bball-pregame-projection']).toBe('preview'));
    test("off: no read, and the prep is today's (no projection key)", async () => {
        const { r } = await prep('mbb', '401909524', FX.pages['401909524'], OFF);
        expect(r.pregame).toBe(true);
        expect('projection' in r).toBe(false);
        expect(api.calls).toEqual([]);
    });
    test("on, college two games in: the producer's row as published, no site hold (its rating blends the prior)", async () => {
        const { r, headers } = await prep('mbb', '401909524', FX.pages['401909524']);
        const p: PregameProjection = r.projection;
        expect(p).toEqual(row('mbb.2027.401909524'));
        expect([p.home_games, p.away_games, p.prior_games]).toEqual([2, 2, 4]); // fewer games than the prior, and still a card
        expect(api.calls.map((c) => `${c.schema}.${c.table}.${c.query.season}.${c.query.game_id}`)).toEqual(['mbb.rated_priors.2027.401909524']);
        expect(headers.get('Cache-Control') ?? '').not.toMatch(/no-store/);
    });
    test("on, a neutral site: the producer's row carries no home edge", async () => {
        const { r } = await prep('mbb', '401916290', FX.pages['401916290']);
        expect(r.projection.neutral_site).toBe(true);
        expect(r.projection.hfa).toBe(0);
    });
    test('on, the NBA: read by the ESPN game id, no team mapping', async () => {
        const { r } = await prep('nba', '401909994', FX.pages['401909994']);
        expect(r.projection).toEqual(row('nba.2027.401909994'));
    });
    test('on, no row (a preseason game): no card, and the page keeps its cache', async () => {
        const { r, headers } = await prep('nba', '401898403', NBA_PRESEASON);
        expect(r.projection).toBeNull();
        expect(headers.get('Cache-Control') ?? '').not.toMatch(/no-store/);
    });
    test("on, a null prediction (a pro side yet to play, as the opening week's rows publish it): no card", async () => {
        const opening = row('nba.2026.401809243');
        expect([opening.exp_home_margin, opening.rated_home_prob]).toEqual([null, null]);
        api.rows['nba.2027.401909994'] = [{ ...row('nba.2027.401909994'), exp_home_margin: opening.exp_home_margin, rated_home_prob: opening.rated_home_prob }];
        expect((await prep('nba', '401909994', FX.pages['401909994'])).r.projection).toBeNull();
    });
    test("on, the producer's home side is not ESPN's: no card rather than a flipped one", async () => {
        const g = row('wbb.2027.401911739');
        api.rows['wbb.2027.401911739'] = [{ ...g, home_team_id: g.away_team_id, away_team_id: g.home_team_id }];
        expect((await prep('wbb', '401911739', FX.pages['401911739'])).r.projection).toBeNull();
    });
    test("on, a day-out game keeps the pregame's hold, which is inside the table's 6 h window", async () => {
        // utils/config getGameCacheConfig holds every scheduled game an hour, so the card is never older than the row it
        // reads; if that ever grows past the table's window, this test is the reminder to cap the pregame page
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-08T16:00:00Z')); // MARQ at MICH tips 2026-11-11
        try {
            const { cache } = await prep('mbb', '401909524', FX.pages['401909524']);
            expect(cache.map((c: any) => c.maxAge)).toEqual([60 * 60]);
        } finally { vi.useRealTimers(); }
    });
    test('on, a failed read: no card, never held', async () => {
        api.fail = true;
        const { r, headers } = await prep('wbb', '401911739', FX.pages['401911739']);
        expect(r.pregame).toBe(true);
        expect(r.projection).toBeNull();
        expect(headers.get('Cache-Control')).toMatch(/no-store/);
    });
});

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('NbaPregameProjection', () => {
    const render = async (league: 'mbb' | 'wbb' | 'nba', id: string) => {
        const page = FX.pages[id];
        const { r } = await prep(league, id, page);
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame: page, projection: r.projection }, locals: { league } as App.Locals });
        return html.slice(html.indexOf('id="pregame-projection"'));
    };
    test("college: the producer's margin and chance, each side's blended rating and games, and the home edge", async () => {
        const card = await render('mbb', '401909524');
        expect(card).toMatch(/<span>MICH by 7\.9<\/span>/);
        expect(card).toContain('76% by adjusted efficiency margin with a 4-game preseason prior, 2026-27');
        expect(card).toContain('MICH +35.1 (#10), 2 games');
        expect(card).toContain('home court +2.9 pts');
    });
    test('a neutral site says so', async () => {
        const card = await render('mbb', '401916290');
        expect(card).toMatch(/<span>IU by 1\.0<\/span>/);
        expect(card).toContain('54% by adjusted efficiency margin');
        expect(card).toContain('neutral site, no home edge');
    });
    test("women: the away side favoured, at the women's 3-game prior", async () => {
        const card = await render('wbb', '401911739');
        expect(card).toMatch(/<span>CONN by 0\.2<\/span>/);
        expect(card).toContain('51% by adjusted efficiency margin with a 3-game preseason prior');
    });
    test('the pros: adjusted net rating', async () => {
        const card = await render('nba', '401909994');
        expect(card).toMatch(/<span>BOS by 7\.5<\/span>/);
        expect(card).toContain('70% by adjusted net rating, 2026-27');
        expect(card).toContain('BOS +4.1 (#4), 12 games');
        expect(card).toContain('home court +2.2 pts');
    });
    test("through NbaGameRoute: the route's prep reaches the card; off, no card", async () => {
        const { r: data } = await prep('mbb', '401909524', FX.pages['401909524']);
        const html = await container.renderToString(NbaGameRoute, { props: { data }, locals: { league: 'mbb' } as App.Locals });
        expect(html).toMatch(/id="pregame-projection"[\s\S]*<span>MICH by 7\.9<\/span>/);
        const { r: off } = await prep('mbb', '401909524', FX.pages['401909524'], OFF);
        expect(await container.renderToString(NbaGameRoute, { props: { data: off }, locals: { league: 'mbb' } as App.Locals })).not.toContain('pregame-projection');
    });
    test('no projection: no card', async () => {
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame: FX.pages['401909524'], projection: null }, locals: { league: 'mbb' } as App.Locals });
        expect(html).not.toContain('pregame-projection');
    });
});

describe('the bracketology bracket keeps its bid chances (Q2)', () => {
    test('on or off: no read, and the numbers stay the chance to make the field', async () => {
        const at = new Date('2026-11-08T00:00:00Z');
        for (const locals of [ON, OFF]) {
            const data = await prepareBracketology(fakeAstro('mbb', 'x', locals).astro, 'mbb', at) as any;
            expect('ratings' in data).toBe(false);
            const html = await container.renderToString(BracketologyRoute, { props: { data }, locals: { league: 'mbb', preview: true } as App.Locals });
            expect(html).toContain('title="Chance to make the field on Selection Sunday"');
            expect(html).not.toContain('bracket-game-odds');
        }
        expect(api.calls).toEqual([]);
    });
});
