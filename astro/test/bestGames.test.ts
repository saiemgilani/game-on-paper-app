// BB-G29: /<league>/best-games. The join, filters and order, the loader's season pick and fallback, the reads' queries, the
// template and the flag, on real producer output: `fixtures/best-games-wnba-2025.json.gz` holds sdv-py
// season_game_excitement on the 2025 WNBA pbp release (the rows sdv-db loads into wnba.game_excitement) and the same
// release's schedule, in the reads' columns (see fixtures/README.md).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BestGameScheduleRow, GameExcitementRow } from '../src/resources/bestGames';

const fixture = (): { game_excitement: GameExcitementRow[]; schedule: BestGameScheduleRow[] } =>
    JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/best-games-wnba-2025.json.gz', import.meta.url))).toString());

const reads = vi.fn();
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()), retrieveRowsFrom: (...a: unknown[]) => reads(...a) }));

const { joinBestGames, filterBestGames, teamOptions, isDay, BOARD_SIZE } = await import('../src/utils/bestGames');
const { prepareBestGames } = await import('../src/routes/basketball/bestGames');
const { default: BestGamesRoute } = await import('../src/components/routes/BestGamesRoute.astro');
const { default: Header } = await import('../src/components/Header.astro');
const { FLAGS } = await import('../src/utils/features');

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

/** A day in the 2026 WNBA season (which the fixture has no rows for): the board's current season is 2026. */
const MARCH = new Date('2026-03-01T12:00:00Z');

/** Serve the fixture for `season` (2025) and empty tables for any other, recording each query. */
function serve(season = 2025) {
    reads.mockReset();
    reads.mockImplementation(async (_src: unknown, table: string, q: Record<string, string>) => {
        if (Number(q.season) !== season) return [];
        const f = fixture();
        return table === 'game_excitement' ? f.game_excitement : f.schedule;
    });
}
function fakeAstro(path: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('joinBestGames', () => {
    const f = fixture();
    const games = joinBestGames(f.game_excitement, f.schedule);
    test("every completed game, by the producer's GEI (its rank 1 first), with the schedule's day, teams and score", () => {
        expect(games).toHaveLength(312);
        expect(games[0]).toMatchObject({ gameId: '401736289', rank: 1, n: 312 });
        expect(games[0].gei).toBeCloseTo(11.1795, 3);
        expect(games.map((g) => g.rank)).toEqual([...games.map((g) => g.rank)].sort((a, b) => a! - b!));
        for (const g of games) expect(g.date).toMatch(/^2025-\d{2}-\d{2}$/);
    });
    test('the postseason and its note', () => {
        const finals = games.filter((g) => g.note?.startsWith('WNBA Finals'));
        expect(finals.length).toBeGreaterThan(0);
        expect(finals.every((g) => g.postseason)).toBe(true);
        expect(games.filter((g) => g.postseason)).toHaveLength(24);
    });
    test('ids join as one string form whatever dtype each table sends', () => {
        const asText = f.schedule.map((r) => ({ ...r, id: String(r.id) as unknown as number }));
        expect(joinBestGames(f.game_excitement, asText).map((g) => g.gameId)).toEqual(games.map((g) => g.gameId));
        for (const g of games) expect(g.gameId).not.toContain('.');
    });
    test('a live game (not completed), a null GEI and a game the schedule lacks are left out', () => {
        const [a, b, c] = f.game_excitement;
        const rows = [{ ...a, completed: false }, { ...b, gei: null }, { ...c, game_id: 1 }, ...f.game_excitement.slice(3)];
        expect(joinBestGames(rows, f.schedule)).toHaveLength(309);
    });
});

describe('filterBestGames and the team options', () => {
    const f = fixture();
    const games = joinBestGames(f.game_excitement, f.schedule);
    test('no filter: the top of the board', () => {
        expect(filterBestGames(games, { from: null, to: null, team: null })).toEqual(games);
    });
    test('a day range is inclusive at both ends', () => {
        const day = games[0].date;
        const one = filterBestGames(games, { from: day, to: day, team: null });
        expect(one.length).toBeGreaterThan(0);
        expect(one.every((g) => g.date === day)).toBe(true);
        expect(one[0]).toBe(games[0]);
        const playoffs = filterBestGames(games, { from: '2025-09-14', to: null, team: null });
        expect(playoffs.every((g) => g.postseason)).toBe(true);
    });
    test('a team: its home and away games only', () => {
        const id = games[0].home.id;
        const mine = filterBestGames(games, { from: null, to: null, team: id });
        expect(mine.length).toBeGreaterThan(40);
        expect(mine.every((g) => g.home.id === id || g.away.id === id)).toBe(true);
    });
    test("the 2025 WNBA's 13 teams to pick, by name, and the All-Star Game's two (the producer ranks that game too)", () => {
        const opts = teamOptions(games);
        expect(opts).toHaveLength(15);
        expect(opts.map((t) => t.name)).toEqual(expect.arrayContaining(['TEAM CLARK', 'TEAM COLLIER']));
        expect(opts.map((t) => t.name)).toEqual([...opts.map((t) => t.name)].sort((a, b) => a.localeCompare(b)));
        expect(opts.map((t) => t.name)).toContain('Golden State Valkyries');
    });
    test('isDay', () => {
        expect(isDay('2025-06-01')).toBe(true);
        for (const bad of ['', null, '2025-6-1', '2025-13-40', 'x', '2025-06-01T00:00']) expect(isDay(bad)).toBe(false);
    });
});

describe('the reads and the loader', () => {
    beforeEach(() => serve());
    test("season-filtered reads of the ESPN-keyed schema, completed games only, the page's columns", async () => {
        await prepareBestGames(fakeAstro('/wnba/best-games?season=2025').astro, 'wnba', MARCH);
        const [gei, sched] = ['game_excitement', 'schedule'].map((t) => reads.mock.calls.find((c) => c[1] === t)!);
        expect((gei[0] as any).schema).toBe('wnba');
        expect(gei[2]).toMatchObject({ season: '2025', completed: 'true', select: 'game_id,season,gei,lead_changes,max_swing_pts,completed,gei_rank,gei_pct,gei_n' });
        expect(gei[2]).not.toHaveProperty('order');
        expect(sched[2]).toMatchObject({ season: '2025' });
        expect(gei[4]).toBe(true); // strict: an outage is never an empty season
    });
    test('the default season with no completed games falls back to last season, labelled and cached', async () => {
        const { astro, cache } = fakeAstro('/wnba/best-games');
        const r = await prepareBestGames(astro, 'wnba', MARCH) as any;
        expect(r).toMatchObject({ season: 2025, current: 2026, fallback: true, total: 312, days: { first: '2025-05-16', last: '2025-10-10' } });
        expect(r.games).toHaveLength(BOARD_SIZE);
        expect(cache).toEqual([{ maxAge: 21600, swr: 21600, tags: ['wnba'] }]);
    });
    test("the current season's own ?season= falls back the same way", async () => {
        expect(await prepareBestGames(fakeAstro('/wnba/best-games?season=2026').astro, 'wnba', MARCH)).toMatchObject({ season: 2025, fallback: true });
    });
    test('an explicit past season never falls back; an empty one is uncacheable', async () => {
        const { astro, headers } = fakeAstro('/wnba/best-games?season=2024');
        const r = await prepareBestGames(astro, 'wnba', MARCH) as any;
        expect(r).toMatchObject({ season: 2024, fallback: false, matched: 0, total: 0, games: [], days: null });
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('the filters are read from the URL; a bad day or an unknown team is ignored', async () => {
        const team = joinBestGames(fixture().game_excitement, fixture().schedule)[0].home.id;
        const r = await prepareBestGames(fakeAstro(`/wnba/best-games?season=2025&from=2025-07-01&to=2025-07-31&team=${team}`).astro, 'wnba', MARCH) as any;
        expect(r.filter).toEqual({ from: '2025-07-01', to: '2025-07-31', team });
        expect(r.games.every((g: any) => g.date >= '2025-07-01' && g.date <= '2025-07-31' && (g.home.id === team || g.away.id === team))).toBe(true);
        const bad = await prepareBestGames(fakeAstro('/wnba/best-games?season=2025&from=July&team=999999').astro, 'wnba', MARCH) as any;
        expect(bad.filter).toEqual({ from: null, to: null, team: null });
    });
    test('a day range: the board is the first 50 of the matches, and the count is all of them', async () => {
        const r = await prepareBestGames(fakeAstro('/wnba/best-games?season=2025&from=2025-07-01').astro, 'wnba', MARCH) as any;
        expect(r.matched).toBe(joinBestGames(fixture().game_excitement, fixture().schedule).filter((g) => g.date >= '2025-07-01').length);
        expect(r.matched).toBeGreaterThan(BOARD_SIZE);
        expect(r.games).toHaveLength(BOARD_SIZE);
    });
    test('the current season is the one being played: college from August, the WNBA from November', async () => {
        const nov = new Date('2026-11-04T12:00:00Z');
        expect(await prepareBestGames(fakeAstro('/mbb/best-games').astro, 'mbb', nov)).toMatchObject({ current: 2027, season: 2026, fallback: true });
        expect(await prepareBestGames(fakeAstro('/wnba/best-games').astro, 'wnba', nov)).toMatchObject({ current: 2027, season: 2026, fallback: true });
        const r = await prepareBestGames(fakeAstro('/nba/best-games').astro, 'nba', nov) as any;
        expect(r.current).toBe(2027);
        expect(r.seasons[0]).toBe(2002);
    });
    test('a failed read: unavailable, uncacheable', async () => {
        reads.mockRejectedValue(new Error('503'));
        const { astro, headers } = fakeAstro('/wnba/best-games');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await prepareBestGames(astro, 'wnba', MARCH)).toEqual({ unavailable: true });
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

describe('the template', () => {
    beforeEach(() => serve());
    const page = async (path: string) => {
        const r = await prepareBestGames(fakeAstro(path).astro, 'wnba', MARCH) as any;
        return container.renderToString(BestGamesRoute, { props: { data: r }, locals: { league: 'wnba', preview: true } as App.Locals });
    };
    test('one row per game, linked to its game page, one number per cell', async () => {
        const html = await page('/wnba/best-games?season=2025');
        expect(html).toContain('<h1 class="fs-3 m-0">WNBA Best Games, 2025</h1>');
        expect(html.match(/<tr>/g)).toHaveLength(BOARD_SIZE + 1);
        expect(html).toContain('href="/wnba/game/401736289"');
        expect(html).toContain('>11.18</td>');
        expect(html).toContain('id="best-games-scope">');
        expect(html).toContain('The top 50 of 312 completed games.');
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('undefined');
    });
    test("the fallback label and the filters' state", async () => {
        const html = await page('/wnba/best-games');
        expect(html).toContain('id="best-games-fallback">The 2026 season has no completed games yet. These are 2025\'s best games.');
        const f = await page('/wnba/best-games?season=2025&from=2025-07-01&to=2025-07-31');
        expect(f).toContain('value="2025-07-01"');
        expect(f).toContain('id="best-games-clear"');
        expect(f).toContain(', Jul 1 to Jul 31 (312 in the season).');
    });
    test('no game matches the filters; no season at all', async () => {
        expect(await page('/wnba/best-games?season=2025&from=2025-12-01')).toContain('id="best-games-none">No games match these filters.');
        const empty = await page('/wnba/best-games?season=2024');
        expect(empty).toContain('id="best-games-empty">There are no ranked games for 2024.');
        expect(empty).not.toContain('<table');
    });
});

describe("the board behind 'bball-gei'", () => {
    test('ships as preview', () => { expect(FLAGS['bball-gei']).toBe('preview'); });
    test('every basketball Header lists Best Games only with the flag', async () => {
        for (const league of ['nba', 'wnba', 'mbb', 'wbb'] as const) {
            const on = await container.renderToString(Header, { locals: { league, preview: true } as App.Locals });
            expect(on).toContain(`<a href="/${league}/best-games" class="nav-link px-2 link-secondary">Best Games</a>`);
            const off = await container.renderToString(Header, { locals: { league, preview: true, flagOverrides: { 'bball-gei': false } } as any });
            expect(off).not.toContain('/best-games"');
        }
        const cfb = await container.renderToString(Header, { locals: { league: 'cfb', preview: true } as App.Locals });
        expect(cfb).not.toContain('/best-games"');
    });
});
