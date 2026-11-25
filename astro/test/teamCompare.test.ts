// BB-G60: /<league>/teams/compare, behind 'bball-team-compare'. Real data only (fixtures/README.md: team-compare-2026.json.gz,
// the producers' 2025-26 team_season_rates `all` rows and team_strength rows of the Nets, Celtics and Knicks, Duke and North
// Carolina). The page reads only those two tables, and each cell is the producer's value, rank and percentile.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const FIX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/team-compare-2026.json.gz', import.meta.url))).toString());
const calls: [string, string, Record<string, string>][] = [];
const read = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/resources/sdv', () => ({
    retrieveRows: async (league: string, table: string, q: Record<string, string>) => {
        calls.push([league, table, q]);
        if (read.fail) throw new Error('503');
        const rows = FIX[league]?.[table === 'team_season_rates' ? 'rates' : 'strength'] ?? [];
        return rows.filter((r: any) => String(r.team_id) === q.team_id && String(r.season) === q.season);
    },
    retrieveRowsFrom: async () => { throw new Error('unexpected read'); },
}));

import { parseTeamIds, prepareTeamCompare, teamCompareHref } from '../src/routes/basketball/teamCompare';
import { FLAGS } from '../src/utils/features';
import { bballOnly } from './helpers/flags';

const on = (extra: Record<string, boolean> = {}) => ({ preview: true, flagOverrides: { ...bballOnly('bball-team-compare', 'bball-team-strength'), ...extra } });
const prep = (league: 'nba' | 'mbb', query: string, locals: Record<string, unknown> = on()) => {
    const astro: any = { locals, url: new URL(`https://gameonpaper.com/${league}/teams/compare${query}`), params: {}, response: { headers: new Headers() }, cache: { set: vi.fn() } };
    return prepareTeamCompare(astro, league);
};
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = async (league: 'nba' | 'mbb', query: string, locals: Record<string, unknown> = on()) => {
    const { default: Page } = await import(/* @vite-ignore */ `../src/pages/${league}/teams/compare.astro`);
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/${league}/teams/compare${query}`), locals: locals as unknown as App.Locals });
};
const card = (page: string, id: number) => page.split(`data-compare-card="${id}"`)[1]?.split('data-compare-card=')[0] ?? '';
const cells = (c: string, section: string) => [...(c.split(`data-compare-category="${section}"`)[1] ?? '').split('</table>')[0]
    .matchAll(/<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => [m[1].replace(/<[^>]*>/g, '').trim(), m[2], m[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()]);

describe('the URL', () => {
    test('?ids= takes up to four positive integers, deduped, in order', () => {
        expect(parseTeamIds('1610612751, 1610612738,x,1610612751,0,-3,1,2,3')).toEqual([1610612751, 1610612738, 1, 2]);
        expect(parseTeamIds(null)).toEqual([]);
    });
    test('the current season stays off the URL', () => {
        expect(teamCompareHref('nba', [1, 2], 2026, 2026)).toBe('/nba/teams/compare?ids=1,2');
        expect(teamCompareHref('mbb', [150], 2025, 2026)).toBe('/mbb/teams/compare?ids=150&season=2025');
    });
});

describe("'bball-team-compare'", () => {
    test('is a preview flag; off, the page is a 404 with no read', async () => {
        expect(FLAGS['bball-team-compare']).toBe('preview');
        calls.length = 0;
        expect(await prep('nba', '?ids=1610612751', { preview: false })).toEqual({ notFound: true });
        expect(calls).toEqual([]);
    });
    test('without the strength flag no strength read is made', async () => {
        calls.length = 0;
        await prep('nba', '?ids=1610612751&season=2026', on({ 'bball-team-strength': false }));
        expect(calls.map(([, t]) => t)).toEqual(['team_season_rates']);
    });
    test('reads only the season block rows: the all split and team_strength, one each per team', async () => {
        calls.length = 0;
        const r = await prep('nba', '?ids=1610612751,1610612738&season=2026');
        expect('entries' in r && r.entries.every((e) => !('missing' in e))).toBe(true);
        expect(calls.map(([, t, q]) => [t, q.team_id, q.split ?? null]).sort()).toEqual([
            ['team_season_rates', '1610612738', 'all'], ['team_season_rates', '1610612751', 'all'],
            ['team_strength', '1610612738', null], ['team_strength', '1610612751', null],
        ]);
    });
    test('a failed read is the 503', async () => {
        read.fail = true;
        try { expect(await prep('nba', '?ids=1610612751&season=2026')).toEqual({ unavailable: true }); } finally { read.fail = false; }
    });
});

describe('the page', () => {
    test("three NBA teams: each card's cells are the producer's value, rank and percentile shading", async () => {
        const html = await render('nba', '?ids=1610612751,1610612738,1610612752&season=2026');
        for (const id of [1610612751, 1610612738, 1610612752]) {
            const rates = FIX.nba.rates.find((r: any) => r.team_id === id);
            const st = FIX.nba.strength.find((r: any) => r.team_id === id);
            const c = card(html, id);
            const ratings = cells(c, 'ratings');
            expect(ratings.map((x) => x[0])).toEqual(['Net', 'ORtg', 'DRtg', 'Pace']);
            expect(ratings[1][2]).toBe(`${rates.off_rtg.toFixed(1)} #${rates.off_rtg_rank}`);
            expect(ratings[3][1]).not.toMatch(/hulk-bg/); // pace is never shaded
            const offense = cells(c, 'offense');
            expect(offense[0][2].startsWith(`${(rates.efg_pct * 100).toFixed(1)}%`)).toBe(true);
            expect(cells(c, 'defense')).toHaveLength(4);
            const strength = cells(c, 'strength');
            expect(strength[0][2]).toContain(`#${st.adj_net_rtg_rank}`);
            expect(c).toContain(`${st.wins}-${st.losses}`);
            // the full name from md up, the tricode below it
            expect(c).toMatch(/<span class="d-md-none">[A-Z]{2,4}<\/span>/);
        }
        expect(html).toContain('id="team-compare-add"');
    });
    test('college: tempo and adjusted efficiency margin labels; without the strength flag no strength section', async () => {
        const html = await render('mbb', '?ids=150,153&season=2026');
        expect(cells(card(html, 150), 'ratings')[3][0]).toBe('Tempo');
        expect(cells(card(html, 150), 'strength')[0][0]).toBe('Adj. EM');
        const plain = await render('mbb', '?ids=150&season=2026', on({ 'bball-team-strength': false }));
        expect(card(plain, 150)).not.toContain('data-compare-category="strength"');
    });
    test('an id with no row that season keeps a "no line" card; four teams hide the add control', async () => {
        const html = await render('nba', '?ids=1610612751,1610612738,1610612752,1610612737&season=2026');
        expect(card(html, 1610612737)).toContain('No 2025-26 line for this team.');
        // the card still names the team (the Atlanta Hawks are a 2025-26 team with no row in the capture)
        expect(card(html, 1610612737)).toMatch(/data-compare-missing-name>[^<]*Hawks</);
        expect(html).not.toContain('id="team-compare-add"');
    });
});

describe('ids from another league, and indexing', () => {
    const prepWith = async (league: 'nba' | 'mbb', query: string) => {
        const astro: any = { locals: on(), url: new URL(`https://gameonpaper.com/${league}/teams/compare${query}`), params: {}, response: { headers: new Headers() }, cache: { set: vi.fn() } };
        return { r: await prepareTeamCompare(astro, league), headers: astro.response.headers as Headers };
    };
    test("Duke's ESPN id on the NBA page, or a Celtics id on the men's page, is a 404 with no read", async () => {
        calls.length = 0;
        expect((await prepWith('nba', '?ids=1610612751,150&season=2026')).r).toEqual({ notFound: true });
        expect((await prepWith('mbb', '?ids=150,1610612738&season=2026')).r).toEqual({ notFound: true });
        expect(calls).toEqual([]);
    });
    test('every compare URL is noindex, the 404 and the comparison alike', async () => {
        const ok = await prepWith('nba', '?ids=1610612751,1610612738&season=2026');
        expect('entries' in ok.r).toBe(true);
        expect(ok.headers.get('X-Robots-Tag')).toBe('noindex');
        expect((await prepWith('nba', '?ids=150')).headers.get('X-Robots-Tag')).toBe('noindex');
    });
});
