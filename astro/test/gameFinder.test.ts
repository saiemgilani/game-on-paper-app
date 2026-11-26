// BB-G57: /<league>/games/find, behind 'bball-game-finder'. Real data only (fixtures/README.md: game-finder-wnba-2025.json.gz, sdv-db's
// game finder run over the whole 2025 WNBA release season). Every total, count and row on the page is the route's answer.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const FIX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-finder-wnba-2025.json.gz', import.meta.url))).toString());
const calls: [string, string, Record<string, string>][] = [];
const read = vi.hoisted(() => ({ fail: false }));
// the filters a query carries, order-free (the page adds the unit, its sort and the caps)
const strip = ({ order: _o, limit: _l, counts_limit: _c, unit: _u, ...rest }: Record<string, string>) => Object.entries(rest).sort();
vi.mock('../src/resources/sdv', () => ({
    retrieveBodyFrom: async (source: { apiBase: string }, endpoint: string, q: Record<string, string>) => {
        calls.push([source.apiBase, endpoint, q]);
        if (read.fail) throw new Error('503');
        const hit = Object.values(FIX).find((f: any) => JSON.stringify(strip(f.query)) === JSON.stringify(strip(q)) && f.body.unit === q.unit) as any;
        if (!hit) throw new Error(`no fixture for ${JSON.stringify(q)}`);
        return hit.body;
    },
    retrieveRows: async () => { throw new Error('unexpected read'); },
    retrieveRowsFrom: async () => { throw new Error('unexpected read'); },
}));

import { prepareGameFinder } from '../src/routes/basketball/gameFinder';
import { keyedRequest } from '../src/utils/cacheKey';
import { FLAGS } from '../src/utils/features';
import { finderHref, finderQuery, parseFinder } from '../src/utils/gameFinder';
import { bballOnly } from './helpers/flags';

const on = () => ({ preview: true, flagOverrides: bballOnly('bball-game-finder') });
const SEASONS = [2023, 2024, 2025, 2026];
const prep = (query: string, locals: Record<string, unknown> = on()) => {
    const astro: any = { locals, url: new URL(`https://gameonpaper.com/wnba/games/find${query}`), params: {}, response: { headers: new Headers() }, cache: { set: vi.fn() } };
    return prepareGameFinder(astro, 'wnba');
};
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = async (query: string, locals: Record<string, unknown> = on()) => {
    const { default: Page } = await import('../src/pages/wnba/games/find.astro');
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/wnba/games/find${query}`), locals: locals as unknown as App.Locals });
};
const section = (html: string, id: string) => html.split(`id="${id}"`)[1]?.split('</section>')[0] ?? '';

describe('the URL', () => {
    test('thresholds are whole numbers on the unit, seasons are listed ones, a reversed range is put in order', () => {
        const f = parseFinder(new URLSearchParams('pts=30&reb=x&ast=1.5&min=40&fg3m=05&from=2026&to=2023&type=3&ha=away&res=W&bogus=1'), SEASONS, 2026);
        expect(f).toEqual({ unit: 'player', stats: { pts: 30, fg3m: 5, min: 40 }, from: 2023, to: 2026, type: 3, homeAway: 'away', result: 'W' });
        // minutes are not on the team box, and an unknown season is the current one
        expect(parseFinder(new URLSearchParams('unit=team&min=40&pts=100&from=1990'), SEASONS, 2026)).toMatchObject({ unit: 'team', stats: { pts: 100 }, from: 2026, to: 2026 });
    });
    test("the API query: one __gte per threshold, ordered by the first, the route's caps", () => {
        const f = parseFinder(new URLSearchParams('reb=10&pts=20&from=2025&to=2025&type=3'), SEASONS, 2026);
        expect(finderQuery(f)).toEqual({ unit: 'player', season_from: '2025', season_to: '2025', pts__gte: '20', reb__gte: '10', season_type: '3', order: '-pts', limit: '100', counts_limit: '25' });
    });
    test('every finder parameter is kept in the cache key, so a search never renders the default page', () => {
        const all = 'ast=1&blk=1&fg3m=1&from=2025&ftm=1&ha=home&min=1&pts=1&reb=1&res=W&stl=1&to=2025&tov=1&type=3&unit=team';
        expect(new URL(keyedRequest(new Request(`https://gameonpaper.com/wnba/games/find?${all}&utm_source=x`)).url).search).toBe(`?${all}`);
    });
    test('defaults stay off the page URL', () => {
        expect(finderHref('/wnba/games/find', parseFinder(new URLSearchParams('pts=30'), SEASONS, 2026), 2026)).toBe('/wnba/games/find?pts=30');
        expect(finderHref('/wnba/games/find', parseFinder(new URLSearchParams('unit=team&pts=100&from=2025&to=2025&ha=home&res=W'), SEASONS, 2026), 2026))
            .toBe('/wnba/games/find?unit=team&pts=100&from=2025&to=2025&ha=home&res=W');
    });
});

describe("'bball-game-finder'", () => {
    test('is a preview flag; off, the page is a 404 with no read', async () => {
        expect(FLAGS['bball-game-finder']).toBe('preview');
        calls.length = 0;
        expect(await prep('?pts=30', { preview: false })).toEqual({ notFound: true });
        expect(calls).toEqual([]);
    });
    test('no threshold, no read', async () => {
        calls.length = 0;
        const r = await prep('?from=2025&to=2025');
        expect('body' in r && r.body).toBe(null);
        expect(calls).toEqual([]);
    });
    test("one read of the league's ESPN-keyed game finder", async () => {
        calls.length = 0;
        await prep('?pts=30&from=2025&to=2025');
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toBe('https://data.sportsdataverse.org/v1/wnba');
        expect(calls[0][1]).toBe('game_finder');
    });
    test('a failed read is the 503', async () => {
        read.fail = true;
        try { expect(await prep('?pts=30&from=2025&to=2025')).toEqual({ unavailable: true }); } finally { read.fail = false; }
    });
});

describe('the page', () => {
    test("30-point games: the total, the most-games table and every row are the route's", async () => {
        const body = FIX.player_pts30.body;
        const html = await render('?pts=30&from=2025&to=2025');
        expect(html).toMatch(new RegExp(`id="game-finder-summary"[^>]*>\\s*<span class="fw-bold numeral">${body.count}</span>`));
        const counts = section(html, 'game-finder-counts');
        const shown = [...counts.matchAll(/data-count-id="(\d+)"[\s\S]*?<td class="text-center numeral fw-bold">(\d+)<\/td>/g)].map((m) => [Number(m[1]), Number(m[2])]);
        expect(shown).toEqual(body.counts.map((c: any) => [c.id, c.games]));
        expect(shown[0][1]).toBeGreaterThan(1); // somebody has more than one 30-point game
        const games = section(html, 'game-finder-games');
        const ids = [...games.matchAll(/data-game-id="(\d+)"/g)].map((m) => Number(m[1]));
        expect(ids).toEqual(body.data.map((r: any) => r.game_id));
        // each row links its game page, and the threshold column is the bold one
        expect(games).toContain(`href="/wnba/game/${body.data[0].game_id}"`);
        expect(games).toMatch(new RegExp(`<td class="text-center numeral fw-bold">${body.data[0].pts}</td>`));
    });
    test('team games: team names link their team pages', async () => {
        const body = FIX.team_pts100_home_w.body;
        const html = await render('?unit=team&pts=100&from=2025&to=2025&ha=home&res=W');
        expect(html).toContain(`<span class="fw-bold numeral">${body.count}</span> team games with 100+ PTS, 2025 (home, wins)`);
        expect(section(html, 'game-finder-counts')).toMatch(/<a href="\/wnba\/team\/\d+/);
        expect(section(html, 'game-finder-games')).not.toContain('<abbr title="Minutes">');
        expect(section(html, 'game-finder-games')).toContain('<abbr title="Points">PTS</abbr>');
    });
    test('playoff games carry the P badge; without a threshold the page shows the form and an example', async () => {
        const html = await render('?pts=20&reb=10&from=2025&to=2025&type=3');
        expect(section(html, 'game-finder-games')).toContain('title="Playoffs"><span aria-hidden="true">P</span><span class="visually-hidden">Playoffs</span>');
        const start = await render('');
        expect(start).toContain('id="game-finder-start"');
        expect(start).not.toContain('id="game-finder-games"');
    });
});
