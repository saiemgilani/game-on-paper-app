// BB-G18: the pregame projection behind 'bball-pregame-projection' (the bracketology bracket keeps its bid chances). Every number
// is checked against sportsdataverse-py (main 306abe15: mbb_game_predict / nba_game_predict predict_margin and
// win_prob_from_margin) run on the same Data API rows (fixtures/README.md: pregame-projection.json.gz). The reads (one
// season-filtered, capped ratings read), the route gates and the templates. Every Data API read here is mocked.
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
const NBA_PREGAME = JSON.parse(readFileSync(new URL('./fixtures/nba/pregame_401898403.json', import.meta.url)).toString()); // CLE at ORL, a real scheduled capture

const api = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, calls: [] as { schema: string; table: string; query: Record<string, string> }[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        const key = `${source.schema}.${table}.${query.season}`;
        if (!(key in api.rows)) throw new Error(`unexpected read ${key}`);
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
import { retrieveSeasonRatings } from '../src/resources/pregameProjection';
import { PRIOR_GAMES, heldForPrior, projectGame, type TeamRating } from '../src/utils/pregameProjection';
import { FLAGS } from '../src/utils/features';

const ROWS: Record<string, any[]> = {
    'mbb.ratings.2027': FX.ratings.mbb_2027, 'wbb.ratings.2027': FX.ratings.wbb_2027, 'mbb.ratings.2026': FX.ratings.mbb_2026,
    'nba_stats.team_strength.2027': FX.ratings.nba_2027, 'wnba_stats.team_strength.2026': FX.ratings.wnba_2026,
};
beforeEach(() => { api.rows = { ...ROWS }; api.calls = []; api.fail = false; espn.page = null; });

const oracle = (id: string) => FX.oracle.games.find((g: any) => g.game_id === id);
const asRating = (r: any, college: boolean): TeamRating => (college
    ? { team_id: String(r.team_id), rating: r.adj_em, rank: r.rank, games: r.games, pace: null }
    : { team_id: String(r.team_id), rating: r.adj_net_rtg, rank: r.adj_net_rtg_rank, games: r.games, pace: r.pace });
const rating = (rows: any[], id: string, college: boolean) => asRating(rows.find((r) => String(r.team_id) === id), college);
/** the captured early-season college rows (1-4 games in) with every count raised to `n`: the same ratings once both sides
 *  have played the games the producer's prior is worth (Q1's hold) */
const atGames = (rows: any[], n: number) => rows.map((r) => ({ ...r, games: Math.max(r.games, n) }));
const pastPrior = () => { api.rows['mbb.ratings.2027'] = atGames(FX.ratings.mbb_2027, PRIOR_GAMES.mbb); api.rows['wbb.ratings.2027'] = atGames(FX.ratings.wbb_2027, PRIOR_GAMES.wbb); };

describe("projectGame: sdv-py's closed form on the producer's rows", () => {
    test.each([
        ['mbb', 'mbb_2027', '401909524', true], // MARQ at MICH
        ['mbb', 'mbb_2027', '401916290', true], // UK v IU, neutral
        ['wbb', 'wbb_2027', '401911739', true], // CONN at OSU
        ['nba', 'nba_2027', '401898403', false], // CLE at ORL
        ['wnba', 'wnba_2026', 'wnba-ny-min', false], // MIN at NY
    ] as const)('%s %s %s', (league, file, id, college) => {
        const o = oracle(id);
        const p = projectGame(league, rating(FX.ratings[file], o.home, college), rating(FX.ratings[file], o.away, college), o.neutral)!;
        expect(p.margin).toBeCloseTo(o.margin, 9);
        expect(Math.abs(p.homeWinProb - o.home_win_prob)).toBeLessThan(1e-6); // utils/misc calculateNormCdf: |error| < 7.5e-8
    });
    test('a neutral site carries no home edge; a home game the league hfa', () => {
        const [h, a] = [rating(FX.ratings.mbb_2027, '84', true), rating(FX.ratings.mbb_2027, '96', true)];
        expect(projectGame('mbb', h, a, true)!.hfa).toBe(0);
        expect(projectGame('mbb', h, a, false)!.margin - projectGame('mbb', h, a, true)!.margin).toBeCloseTo(2.9281, 9);
    });
    test('a missing rating or pro pace is no projection', () => {
        const h = rating(FX.ratings.nba_2027, '1610612753', false);
        expect(projectGame('nba', h, { ...h, pace: null }, false)).toBeNull();
        expect(projectGame('mbb', { ...h, rating: NaN }, h, false)).toBeNull();
    });
    test('every pair of the 2025-26 field at a neutral site', () => {
        const ratings = new Map(FX.ratings.mbb_2026.map((r: any) => [String(r.team_id), asRating(r, true)])) as Map<string, TeamRating>;
        const pairs = Object.entries(FX.oracle.bracket as Record<string, number>);
        expect(pairs).toHaveLength(2278); // 68 choose 2
        for (const [k, p] of pairs) {
            const [a, b] = k.split('-');
            expect(Math.abs(projectGame('mbb', ratings.get(a)!, ratings.get(b)!, true)!.homeWinProb - p)).toBeLessThan(1e-6);
        }
    });
});

describe("heldForPrior: Q1's college hold until the producer's prior-blended rating is published", () => {
    const r = (games: number | null): TeamRating => ({ team_id: 'x', rating: 1, rank: 1, games, pace: null });
    test("college waits until both sides have played the prior's games (sdv-py PRESEASON_PRIOR weight: men 4, women 3)", () => {
        expect(PRIOR_GAMES).toEqual({ mbb: 4, wbb: 3 });
        expect(heldForPrior('mbb', r(4), r(3))).toBe(true);
        expect(heldForPrior('mbb', r(4), r(4))).toBe(false);
        expect(heldForPrior('wbb', r(2), r(3))).toBe(true);
        expect(heldForPrior('wbb', r(3), r(3))).toBe(false);
        expect(heldForPrior('mbb', r(null), r(9))).toBe(true);
    });
    test('the pros never wait', () => expect(heldForPrior('nba', r(0), r(0))).toBe(false));
});

describe('retrieveSeasonRatings', () => {
    test('college: one season-filtered, capped read of ratings, keyed by ESPN id', async () => {
        const m = await retrieveSeasonRatings('mbb', 2027);
        expect(api.calls).toEqual([{ schema: 'mbb', table: 'ratings', query: { season: '2027', select: 'team_id,adj_em,rank,games', limit: '1000' } }]);
        expect(m.size).toBe(FX.ratings.mbb_2027.length);
        expect(m.get('130')).toEqual(rating(FX.ratings.mbb_2027, '130', true));
    });
    test("the pros: BB-D19's team_strength, keyed by stats id", async () => {
        const m = await retrieveSeasonRatings('nba', 2027);
        expect(api.calls).toEqual([{ schema: 'nba_stats', table: 'team_strength', query: { season: '2027', select: 'team_id,adj_net_rtg,adj_net_rtg_rank,games,pace', limit: '40' } }]);
        expect(m.size).toBe(30);
    });
    test('strict: an outage throws, never an empty season', async () => {
        api.fail = true;
        await expect(retrieveSeasonRatings('wbb', 2027)).rejects.toThrow('down');
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

describe('prepareBasketballGame: the pregame card', () => {
    test("the flag ships as preview", () => expect(FLAGS['bball-pregame-projection']).toBe('preview'));
    test('off: no read, and the prep is today\'s (no projection key)', async () => {
        espn.page = FX.pages['401909524'];
        const r: any = await prepareBasketballGame(fakeAstro('mbb', '401909524', OFF).astro, 'mbb');
        expect(r.pregame).toBe(true);
        expect('projection' in r).toBe(false);
        expect(api.calls).toEqual([]);
    });
    test('on, college two games in (the captured rows): the read, but the card waits for the prior; the page keeps its cache', async () => {
        espn.page = FX.pages['401909524'];
        const { astro, headers } = fakeAstro('mbb', '401909524', ON);
        const r: any = await prepareBasketballGame(astro, 'mbb');
        expect(r.projection).toBeNull();
        expect(api.calls.map((c) => `${c.schema}.${c.table}.${c.query.season}`)).toEqual(['mbb.ratings.2027']);
        expect(headers.get('Cache-Control') ?? '').not.toMatch(/no-store/);
        api.rows['mbb.ratings.2027'] = atGames(FX.ratings.mbb_2027, PRIOR_GAMES.mbb - 1);
        expect(((await prepareBasketballGame(fakeAstro('mbb', '401909524', ON).astro, 'mbb')) as any).projection).toBeNull();
    });
    test('on, college home game past the prior: both ratings and the projection, with the home edge', async () => {
        pastPrior();
        espn.page = FX.pages['401909524'];
        const r: any = await prepareBasketballGame(fakeAstro('mbb', '401909524', ON).astro, 'mbb');
        const p: PregameProjection = r.projection;
        expect(p.season).toBe(2027);
        expect(p.neutral).toBe(false);
        expect([p.home.team_id, p.away.team_id]).toEqual(['130', '269']);
        expect(p.projection.margin).toBeCloseTo(oracle('401909524').margin, 9);
        expect(p.projection.hfa).toBe(2.9281);
        expect(api.calls.map((c) => `${c.schema}.${c.table}.${c.query.season}`)).toEqual(['mbb.ratings.2027']);
    });
    test("on, ESPN's neutral site: no home edge", async () => {
        pastPrior();
        espn.page = FX.pages['401916290'];
        const r: any = await prepareBasketballGame(fakeAstro('mbb', '401916290', ON).astro, 'mbb');
        expect(r.projection.neutral).toBe(true);
        expect(r.projection.projection.hfa).toBe(0);
        expect(r.projection.projection.homeWinProb).toBeCloseTo(oracle('401916290').home_win_prob, 6);
    });
    test('on, the NBA: ESPN ids map to stats ids through the team list', async () => {
        espn.page = NBA_PREGAME;
        const r: any = await prepareBasketballGame(fakeAstro('nba', '401898403', ON).astro, 'nba');
        expect([r.projection.home.team_id, r.projection.away.team_id]).toEqual(['1610612753', '1610612739']);
        expect(r.projection.projection.homeWinProb).toBeCloseTo(oracle('401898403').home_win_prob, 6);
    });
    test('on, a side with no rating (a season not rated yet): no card, and the page keeps its cache', async () => {
        espn.page = FX.pages['401911739'];
        api.rows['wbb.ratings.2027'] = atGames(FX.ratings.wbb_2027, PRIOR_GAMES.wbb).filter((r: any) => String(r.team_id) !== '41');
        const { astro, headers } = fakeAstro('wbb', '401911739', ON);
        const r: any = await prepareBasketballGame(astro, 'wbb');
        expect(r.projection).toBeNull();
        expect(headers.get('Cache-Control') ?? '').not.toMatch(/no-store/);
    });
    test("on, a day-out game keeps the pregame's hold, which is inside the ratings' 6 h window", async () => {
        // utils/config getGameCacheConfig holds every scheduled game an hour (its "within one day" test reads `.days` of a
        // millisecond diff, always 0), so the card is never older than the ratings it reads; if that ever grows past the
        // ratings' window, this test is the reminder to cap the pregame page
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-08T16:00:00Z')); // MARQ at MICH tips 2026-11-11
        try {
            espn.page = FX.pages['401909524'];
            const on = fakeAstro('mbb', '401909524', ON);
            await prepareBasketballGame(on.astro, 'mbb');
            expect(on.cache.map((c: any) => c.maxAge)).toEqual([60 * 60]);
        } finally { vi.useRealTimers(); }
    });
    test('on, a failed read: no card, never held', async () => {
        espn.page = FX.pages['401911739'];
        api.fail = true;
        const { astro, headers } = fakeAstro('wbb', '401911739', ON);
        const r: any = await prepareBasketballGame(astro, 'wbb');
        expect(r.pregame).toBe(true);
        expect(r.projection).toBeNull();
        expect(headers.get('Cache-Control')).toMatch(/no-store/);
    });
});

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('NbaPregameProjection', () => {
    beforeEach(pastPrior);
    const projectionFor = async (league: 'mbb' | 'nba', id: string, page: any) => {
        espn.page = page;
        return ((await prepareBasketballGame(fakeAstro(league, id, ON).astro, league)) as any).projection as PregameProjection;
    };
    test('college: the favourite, the margin and its chance, each side and the home edge', async () => {
        const page = FX.pages['401909524'];
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame: page, projection: await projectionFor('mbb', '401909524', page) }, locals: { league: 'mbb' } as App.Locals });
        const card = html.slice(html.indexOf('id="pregame-projection"'));
        expect(card).toMatch(/<span>MICH by 4\.8<\/span>/);
        expect(card).toContain('66% by adjusted efficiency margin, 2026-27');
        const m = FX.ratings.mbb_2027.find((r: any) => r.team_id === '130');
        expect(card).toContain(`MICH +${m.adj_em.toFixed(1)} (#${m.rank}), ${PRIOR_GAMES.mbb} games`);
        expect(card).toContain('home court +2.9 pts');
    });
    test('a neutral site says so', async () => {
        const page = FX.pages['401916290'];
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame: page, projection: await projectionFor('mbb', '401916290', page) }, locals: { league: 'mbb' } as App.Locals });
        expect(html).toMatch(/<span>IU by 15\.6<\/span>/);
        expect(html).toContain('92% by adjusted efficiency margin');
        expect(html).toContain('neutral site, no home edge');
    });
    test('the pros: adjusted net rating; the away side favoured', async () => {
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame: NBA_PREGAME, projection: await projectionFor('nba', '401898403', NBA_PREGAME) }, locals: { league: 'nba' } as App.Locals });
        expect(html).toMatch(/<span>CLE by 1\.8<\/span>/);
        expect(html).toContain('55% by adjusted net rating, 2026-27');
        expect(html).toContain('home court +2.2 pts');
    });
    test("through NbaGameRoute: the route's prep reaches the card", async () => {
        espn.page = FX.pages['401909524'];
        const data = await prepareBasketballGame(fakeAstro('mbb', '401909524', ON).astro, 'mbb');
        const html = await container.renderToString(NbaGameRoute, { props: { data }, locals: { league: 'mbb' } as App.Locals });
        expect(html).toMatch(/id="pregame-projection"[\s\S]*<span>MICH by 4\.8<\/span>/);
        espn.page = FX.pages['401909524'];
        const off = await prepareBasketballGame(fakeAstro('mbb', '401909524', OFF).astro, 'mbb');
        expect(await container.renderToString(NbaGameRoute, { props: { data: off }, locals: { league: 'mbb' } as App.Locals })).not.toContain('pregame-projection');
    });
    test('no projection: no card', async () => {
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame: FX.pages['401909524'], projection: null }, locals: { league: 'mbb' } as App.Locals });
        expect(html).not.toContain('pregame-projection');
    });
});

describe('the bracketology bracket keeps its bid chances (Q2)', () => {
    test('on or off: no ratings read, and the numbers stay the chance to make the field', async () => {
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
