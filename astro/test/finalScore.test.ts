/**
 * IF-6: the "first time this final score happened" chip. Pure rules, the Data API reads
 * (population + both orientations), and the GameHeader render on both leagues' fixtures.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { earliestFinals, finalScore, finalScoreFirst, firstFinalLabel } from '../src/utils/finalScore';
import { loadGzJson } from './helpers/tables';

// rows() returning a number answers that HTTP status; returning 'hang' never answers (until aborted)
const net = vi.hoisted(() => ({ urls: [] as string[], rows: (_u: URL): any[] | number | 'hang' => [], process: null as any }));
const espn = vi.hoisted(() => ({ page: null as any }));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveGamePageGuarded: async () => ({ page: espn.page, regressed: false, reason: null }),
}));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: RequestInit) => {
        const u = new URL(String(url));
        net.urls.push(u.toString());
        if (u.pathname.endsWith('/process')) return new Response(JSON.stringify(net.process), { status: 200, headers: { 'content-type': 'application/json' } });
        const r = u.pathname.endsWith('/meta') ? [] : net.rows(u);
        if (r === 'hang') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
        if (typeof r === 'number') return new Response('{"detail":"boom"}', { status: r });
        const body = u.pathname.endsWith('/meta') ? { datasets: {} } : { data: net.rows(u) };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

describe('rules', () => {
    test('winner first; a tie is (score, score)', () => {
        expect(finalScore(22, 56)).toEqual([56, 22]);
        expect(finalScore(56, 22)).toEqual([56, 22]);
        expect(finalScore(17, 17)).toEqual([17, 17]);
    });
    test('the earliest rows win, every one tied at that kickoff; none is empty', () => {
        expect(earliestFinals([])).toEqual([]);
        expect(earliestFinals([{ game_id: 2, start_date: '2010-09-01T00:00:00Z' }, { game_id: 1, start_date: '2003-09-01T00:00:00Z' }]).map((r) => r.game_id)).toEqual([1]);
        const tied = earliestFinals([{ game_id: 3, start_date: '2003-09-01T16:00:00Z' }, { game_id: 1, start_date: '2003-09-01T16:00:00Z' }, { game_id: 2, start_date: '2004-09-01T16:00:00Z' }]);
        expect(tied.map((r) => r.game_id)).toEqual([3, 1]);
        // two games that kicked off together with a new final are both first
        expect(finalScoreFirst(tied, '3') && finalScoreFirst(tied, 1)).toBe(true);
    });
    test('first only when this game is the earliest; ids compare as strings', () => {
        expect(finalScoreFirst([{ game_id: 401769074, start_date: '2026-01-10' }], '401769074')).toBe(true);
        expect(finalScoreFirst([{ game_id: 242902325, start_date: '2004-10-16' }], '401769074')).toBe(false);
        // not in the table yet, or outside the population (FBS vs FCS): never first
        expect(finalScoreFirst([], '401769074')).toBe(false);
    });
    test('the label states the span', () => {
        expect(firstFinalLabel('cfb', 22, 56)).toBe('First 56-22 final (FBS vs FBS games since 2001)');
        expect(firstFinalLabel('nfl', 39, 34)).toBe('First 39-34 final (since 1999)');
        expect(firstFinalLabel('nba', 100, 90)).toBeNull();
    });
});

describe('retrieveFirstFinal', () => {
    const scheduleReads = () => net.urls.map((s) => new URL(s)).filter((u) => /\/(schedule|espn_schedule)$/.test(u.pathname));

    test('cfb: both orientations, completed FBS vs FBS games only, earliest of the two', async () => {
        net.urls = [];
        net.rows = (u) => u.searchParams.get('home_points') === '41'
            ? [{ game_id: 2, start_date: '2012-09-01T00:00:00.000Z' }]
            : [{ game_id: 1, start_date: '2005-09-01T00:00:00.000Z' }];
        const { retrieveFirstFinal } = await import('../src/resources/sdv');
        const rows = await retrieveFirstFinal('cfb', 41, 9);
        expect(rows, 'both reads succeeded').not.toBeNull();
        if (rows === null) return;
        expect(rows.map((r) => r.game_id)).toEqual([1]);
        const reads = scheduleReads();
        expect(reads.map((u) => `${u.searchParams.get('home_points')}-${u.searchParams.get('away_points')}`).sort()).toEqual(['41-9', '9-41']);
        for (const u of reads) {
            expect(u.pathname).toBe('/v1/cfb/schedule');
            expect(u.searchParams.get('completed')).toBe('true');
            expect(u.searchParams.get('fbs_game')).toBe('true');
            expect(u.searchParams.get('order')).toBe('start_date');
            expect(u.searchParams.get('limit')).toBe('5');
        }
    });

    test('nfl: espn_schedule, no FBS filter; a tie is one read', async () => {
        net.urls = [];
        net.rows = () => [];
        const { retrieveFirstFinal } = await import('../src/resources/sdv');
        expect(await retrieveFirstFinal('nfl', 13, 13)).toEqual([]);
        const reads = scheduleReads();
        expect(reads).toHaveLength(1);
        expect(reads[0].pathname).toBe('/v1/nfl/espn_schedule');
        expect(reads[0].searchParams.has('fbs_game')).toBe(false);
    });

    test('one orientation failing is no answer, not half of one', async () => {
        // this game is the earliest 52-6 (the 52-6 read), but the 6-52 read fails: it may hold an earlier game
        net.rows = (u) => u.searchParams.get('home_points') === '52' ? [{ game_id: 9, start_date: '2020-09-01T00:00:00.000Z' }] : 500;
        const { retrieveFirstFinal } = await import('../src/resources/sdv');
        expect(await retrieveFirstFinal('cfb', 52, 6)).toBeNull();
    });

    test('a stalled read times out to no answer', async () => {
        net.rows = (u) => (u.searchParams.get('home_points') === '53' ? 'hang' : []);
        const { retrieveFirstFinal } = await import('../src/resources/sdv');
        const t0 = Date.now();
        expect(await retrieveFirstFinal('cfb', 53, 6, 50)).toBeNull();
        expect(Date.now() - t0).toBeLessThan(2000);
    });

    test('a throw before the request (cache/setup) is no answer, not a broken header', async () => {
        net.rows = () => [{ game_id: 9, start_date: '2020-09-01T00:00:00.000Z' }];
        const spy = vi.spyOn(env.SDV_API_CACHE, 'get').mockRejectedValue(new Error('KV down'));
        try {
            const { retrieveFirstFinal } = await import('../src/resources/sdv');
            expect(await retrieveFirstFinal('cfb', 54, 6)).toBeNull();
        } finally {
            spy.mockRestore();
        }
    });
});

describe('game route + GameHeader chip', () => {
    // Real, offline /process payloads: CMU 30 at OKST 27 (2016), JAX 34 at CLE 10 (2026), both final.
    const FIXTURES = { cfb: 'usage-cfb-400869270.json.gz', nfl: 'usage-nfl-401872922.json.gz' } as const;
    let container: AstroContainer;
    beforeAll(async () => {
        container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    });
    /**
     * loadGameRoute (ESPN page + processor answered from the fixture), then GameHeader rendered
     * with the locals the route left behind, as the page does. `schedule` answers the chip's
     * Data API reads.
     */
    const run = async (league: 'cfb' | 'nfl', on: boolean, schedule: () => any[] | number) => {
        const game = loadGzJson(FIXTURES[league]);
        espn.page = { gameId: Number(game.header.id), gamepackageJSON: { header: game.header } };
        net.urls = [];
        net.process = game;
        net.rows = () => schedule();
        const headers = new Headers();
        const cacheCalls: unknown[] = [];
        const locals: any = { league, flagOverrides: { 'final-score-first': on } };
        const astro: any = { params: { id: String(game.header.id) }, locals, url: new URL('https://gameonpaper.com/'), response: { headers },
            cache: { set: (v: unknown) => cacheCalls.push(v) }, redirect: (l: string) => l };
        const { loadGameRoute } = await import('../src/routes/game');
        const r: any = await loadGameRoute(astro, league);
        expect(r.game, 'the fixture loaded').toBeTruthy();
        const { default: GameHeader } = await import('../src/components/game/GameHeader.astro');
        const html = await container.renderToString(GameHeader, { props: { game: r.game }, locals });
        return { html, game, locals, cached: cacheCalls.at(-1) !== false && headers.get('Cache-Control') !== 'no-store',
            reads: net.urls.filter((u) => u.includes('schedule?')).length };
    };
    const chips = (html: string) => [...html.matchAll(/<span class="badge bg-secondary">([^<]+)<\/span>/g)].map((m) => m[1]);
    // Astro islands carry a random uid per render; nothing else may differ
    const strip = (h: string) => h.replace(/uid="[^"]*"/g, '').replace(/astro-island uid=\S+/g, '');

    for (const league of ['cfb', 'nfl'] as const) {
        test(`[${league}] the game that is first gets the chip in both headers, and the render caches`, async () => {
            const game = loadGzJson(FIXTURES[league]);
            const [a, b] = game.header.competitions[0].competitors.map((c: any) => Number(c.score));
            const r = await run(league, true, () => [{ game_id: game.header.id, start_date: '2001-09-01T00:00:00.000Z' }]);
            expect(chips(r.html)).toEqual(Array(2).fill(firstFinalLabel(league, a, b)));
            expect(r.cached).toBe(true);
        });
        test(`[${league}] an earlier game with the score: no chip, cacheable, same header as flag off`, async () => {
            const on = await run(league, true, () => [{ game_id: 1, start_date: '2001-09-01T00:00:00.000Z' }]);
            const off = await run(league, false, () => [{ game_id: 1, start_date: '2001-09-01T00:00:00.000Z' }]);
            expect(chips(on.html)).toEqual([]);
            expect(on.cached).toBe(true);
            expect(off.reads, 'flag off reads nothing').toBe(0);
            expect(off.locals.firstFinal).toBeUndefined();
            expect(off.cached).toBe(true);
            expect(strip(on.html)).toBe(strip(off.html));
        });
        test(`[${league}] a failed lookup: no chip, and the render is NOT cached`, async () => {
            // a game that may really be first must not be cached chipless for the final-game TTL
            const r = await run(league, true, () => 500);
            expect(chips(r.html)).toEqual([]);
            expect(r.cached).toBe(false);
        });
    }
});
