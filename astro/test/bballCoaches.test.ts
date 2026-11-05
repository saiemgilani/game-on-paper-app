// BB-G9: /nba/coaches and /wnba/coaches. The board helpers, the page-side step (the query, the one read, the cache and
// the outage) and the template, on the Data API's own rows (fixtures/bball-coaches-2025.json.gz: sdv-db #196's
// coach_seasons / coach_careers as served on 2026-11-05). Every Data API read is mocked: vitest.config.ts sets
// SDV_AUTH_TOKEN='test', so an unmocked read would hit the API with a bad key.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const rows = vi.hoisted(() => ({ fn: (_league: string, _table: string, _q: Record<string, string>): unknown[] => [], calls: [] as unknown[][] }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: vi.fn(async (league: string, table: string, q: Record<string, string>) => { rows.calls.push([league, table, q]); return rows.fn(league, table, q); }),
}));

import BasketballCoachesRoute from '../src/components/routes/BasketballCoachesRoute.astro';
import Header from '../src/components/Header.astro';
import NotFound from '../src/pages/404.astro';
import NbaCoachesPage from '../src/pages/nba/coaches.astro';
import { prepareBasketballCoaches, type BasketballCoachesParams } from '../src/routes/basketball/coaches';
import { SDVRequestError } from '../src/resources/sdv';
import type { CoachRow } from '../src/utils/coaches';
import { BBALL_COACH_BOARDS, BBALL_COACH_FIRST_SEASON, bballCoachBoard, bballCoachSelect, bballCoachSort, splitBballCoachRows } from '../src/utils/bballCoaches';
import { FLAGS } from '../src/utils/features';

type LeagueFixture = { season: number; seasons: CoachRow[]; careers: CoachRow[] };
const fx: { nba: LeagueFixture; wnba: LeagueFixture } = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/bball-coaches-2025.json.gz', import.meta.url))).toString());

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    container.insertPageRoute('/404', NotFound);
});
beforeEach(() => { rows.calls = []; rows.fn = () => []; });

const astroFor = (url: string) => ({ url: new URL(url), locals: {} as App.Locals, response: { headers: new Headers() } }) as any;

describe('the board helpers', () => {
    test("an unknown or inherited board name is the default board; an unknown sort is the board's default", () => {
        expect(bballCoachBoard('toString').slug).toBe('ratings');
        expect(bballCoachBoard(null).slug).toBe('ratings');
        expect(bballCoachBoard('four-factors').slug).toBe('four-factors');
        expect(bballCoachSort(bballCoachBoard('ratings'), 'efg_pct').key).toBe('net_rtg');
        expect(bballCoachSort(bballCoachBoard('ratings'), 'def_rtg').key).toBe('def_rtg');
    });
    test('the select is every board metric with its producer rank and percentile, and the id columns per table', () => {
        const s = bballCoachSelect(false).split(',');
        for (const m of Object.values(BBALL_COACH_BOARDS).flatMap((b) => b.columns.map((c) => c.key))) expect(s).toEqual(expect.arrayContaining([m, `${m}_rank`, `${m}_pct`]));
        expect(s).toEqual(expect.arrayContaining(['season', 'team_id', 'games', 'wins', 'losses']));
        expect(bballCoachSelect(true).split(',')).toEqual(expect.arrayContaining(['teams', 'first_season', 'last_season']));
        // every column the page selects is one the API served for the fixture (no typo'd column)
        for (const k of s) expect(Object.keys(fx.nba.seasons[0])).toContain(k);
        for (const k of bballCoachSelect(true).split(',')) expect(Object.keys(fx.nba.careers[0])).toContain(k);
    });
    test("2024-25 NBA: the producer's cohort is ranked, the two short stints below the divider", () => {
        const net = bballCoachSort(bballCoachBoard('ratings'), 'net_rtg');
        const { qualified, partial } = splitBballCoachRows(fx.nba.seasons, net);
        expect(qualified).toHaveLength(25);
        expect(partial.map((r) => `${r.team} ${r.coach}`)).toEqual(['MEM Tuomas Iisalo', 'SAC Mike Brown']); // by net rating, as the cohort
        expect(partial.every((r) => r.win_pct_rank === null)).toBe(true);
        // the page's order is the producer's rank order, for a high-is-good and a low-is-good column
        expect(qualified.map((r) => r.net_rtg_rank)).toEqual(qualified.map((_, i) => i + 1));
        const drtg = splitBballCoachRows(fx.nba.seasons, bballCoachSort(bballCoachBoard('ratings'), 'def_rtg')).qualified;
        expect(drtg.map((r) => r.def_rtg_rank)).toEqual(drtg.map((_, i) => i + 1));
        expect(qualified[0]).toMatchObject({ team: 'OKC', coach: 'Mark Daigneault' });
    });
});

describe('prepareBasketballCoaches', () => {
    test('no season: the careers board, one careers read with no season and a bounded limit; cached for the season window', async () => {
        rows.fn = () => fx.nba.careers;
        const A = astroFor('https://gameonpaper.com/nba/coaches');
        const r = await prepareBasketballCoaches(A, 'nba');
        expect(r).toMatchObject({ league: 'nba', season: null, board: 'ratings', sort: 'net_rtg' });
        expect(rows.calls).toEqual([['nba', 'coach_careers', { select: bballCoachSelect(true), limit: '1000' }]]);
        expect(A.locals.league).toBe('nba');
        expect(A.response.headers.get('Cache-Control')).toBeNull();
        const p = r as BasketballCoachesParams;
        expect(p.seasons[0]).toBeGreaterThanOrEqual(2027);
        expect(p.seasons[p.seasons.length - 1]).toBe(BBALL_COACH_FIRST_SEASON);
    });
    test('a season: one season-filtered read of coach_seasons with a small limit; the board and sort from the query', async () => {
        rows.fn = () => fx.wnba.seasons;
        const r = await prepareBasketballCoaches(astroFor('https://gameonpaper.com/wnba/coaches?season=2025&board=four-factors&sort=tov_pct'), 'wnba');
        expect(r).toMatchObject({ league: 'wnba', season: 2025, board: 'four-factors', sort: 'tov_pct' });
        expect(rows.calls).toEqual([['wnba', 'coach_seasons', { season: '2025', select: bballCoachSelect(false), limit: '100' }]]);
    });
    test('a season the tables do not hold is the careers board, never an unfiltered season read', async () => {
        rows.fn = () => fx.nba.careers;
        const r = await prepareBasketballCoaches(astroFor('https://gameonpaper.com/nba/coaches?season=1997'), 'nba');
        expect(r).toMatchObject({ season: null });
        expect(rows.calls[0][1]).toBe('coach_careers');
    });
    test('an empty season is uncached; an outage is the unavailable state, uncached', async () => {
        const A = astroFor('https://gameonpaper.com/nba/coaches?season=2027');
        expect(await prepareBasketballCoaches(A, 'nba')).toMatchObject({ season: 2027, rows: [] });
        expect(A.response.headers.get('Cache-Control')).toBe('no-store');
        rows.fn = () => { throw new SDVRequestError(503, 'coach_seasons', 'Service Unavailable'); };
        const B = astroFor('https://gameonpaper.com/nba/coaches?season=2025');
        expect(await prepareBasketballCoaches(B, 'nba')).toEqual({ unavailable: true });
        expect(B.response.headers.get('Cache-Control')).toBe('no-store');
    });
});

const render = (data: BasketballCoachesParams) => container.renderToString(BasketballCoachesRoute, { props: { data }, locals: { league: data.league, preview: true } as App.Locals });
const seasonsOf = (league: 'nba' | 'wnba') => (league === 'nba' ? [2027, 2026, 2025] : [2026, 2025]);

describe('the template', () => {
    test("a season board: the producer's ranks and percentile shading, pace plain, the partial rows unranked, the notice", async () => {
        const html = await render({ league: 'nba', seasons: seasonsOf('nba'), season: 2025, board: 'ratings', sort: 'net_rtg', rows: fx.nba.seasons });
        expect(html).toContain('2024-25 NBA Head Coaches: Ratings');
        expect(html).toMatch(/id="coach-coverage"[^>]*>[\s\S]*?about 23% of NBA regular-season games have no coach credited/);
        const body = html.slice(html.indexOf('<tbody'));
        const trs = body.split('<tr').slice(1);
        expect(trs).toHaveLength(27 + 1); // 27 rows and the divider
        // OKC first: rank 1, net shaded at the top of the ramp (net_rtg_pct 96.2), pace never shaded
        expect(trs[0]).toContain('Mark Daigneault');
        expect(trs[0]).toMatch(/<td class="text-right">1<\/td>/);
        expect(trs[0]).toMatch(/hulk-bg-level-\d">12\.7</);
        expect(trs[0]).not.toMatch(/hulk-bg-level-\d">\d+\.\d<\/td>\s*<\/tr>/); // the last cell (pace) is unshaded
        expect(trs[0]).toContain('href="/nba/team/1610612760"');
        expect(trs[25]).toContain('coach-partial-divider');
        expect(trs[26]).toContain('Tuomas Iisalo');
        expect(trs[26]).not.toContain('hulk-bg-level');
        expect(trs[27]).toContain('Mike Brown');
        // the season select's options are canonical URLs: Career is the bare path, a season keeps nothing else at its default
        expect(html).toContain('<option value="/nba/coaches">Career</option>');
        expect(html).toContain('<option value="/nba/coaches?season=2025" selected>2024-25</option>');
        expect(html).toContain('href="/nba/coaches?season=2025&amp;sort=def_rtg"');
    });
    test('a tied producer rank prints as a tie (the WNBA 2025 win% cohort)', async () => {
        const html = await render({ league: 'wnba', seasons: seasonsOf('wnba'), season: 2025, board: 'ratings', sort: 'win_pct', rows: fx.wnba.seasons });
        expect(html).toContain('about 45% of WNBA regular-season games');
        expect(html).toMatch(/T-2/);
    });
    test('the careers board: teams and season spans, no team logos, careers wording', async () => {
        const html = await render({ league: 'nba', seasons: seasonsOf('nba'), season: null, board: 'four-factors', sort: 'efg_pct', rows: fx.nba.careers });
        expect(html).toContain('NBA Head Coach Careers: Four Factors');
        expect(html).toContain('<abbr title="DET, IND, DAL">3 teams</abbr>');
        expect(html).toContain('2002–2026 (24)');
        expect(html).toContain('careers count only the credited games');
        expect(html).not.toMatch(/<img[^>]*team-logo-/);
    });
    test('no rows: the empty state, no table', async () => {
        const html = await render({ league: 'nba', seasons: seasonsOf('nba'), season: 2027, board: 'ratings', sort: 'net_rtg', rows: [] });
        expect(html).toContain('No head coach data for the 2026-27 season yet');
        expect(html).not.toContain('<table');
    });
});

describe("the 'bball-coaches' flag", () => {
    test('is preview', () => expect(FLAGS['bball-coaches']).toBe('preview'));
    test('off: /nba/coaches is the site 404 with no Data API read, and the Header has no Coaches entry', async () => {
        const off = { league: 'nba', preview: true, flagOverrides: { 'bball-coaches': false } } as unknown as App.Locals;
        const r = await container.renderToResponse(NbaCoachesPage, { request: new Request('https://gameonpaper.com/nba/coaches'), locals: off });
        expect(r.status).toBe(404);
        expect(rows.calls).toHaveLength(0);
        expect(await container.renderToString(Header, { locals: off })).not.toContain('/nba/coaches');
    });
    test('on: the page renders from the read', async () => {
        rows.fn = () => fx.nba.seasons;
        const r = await container.renderToResponse(NbaCoachesPage, { request: new Request('https://gameonpaper.com/nba/coaches?season=2025'), locals: { preview: true } as App.Locals });
        expect(r.status).toBe(200);
        expect(await r.text()).toContain('Joe Mazzulla');
    });
});
