// BB-G3: the team page's Lineups tab behind 'bball-lineups'. The read's query (the gate, the order, the cap, college's
// names), the URL controls, the names, the page-side step (the flag gates the read; a failed read keeps the page and is
// never cached) and the template, on sdv-db's committed lineup_seasons fixtures: sdv-py's nba_lineup_seasons /
// mbb_lineup_seasons over real games (fixtures/README.md: lineups-*-2025.json.gz). Every Data API read is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

// no network: an unmocked Data API read (vitest's dummy SDV_AUTH_TOKEN) fails auth and locks the IP out, so any fetch throws and is recorded
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { expect(fetched).toEqual([]); });

interface Capture { units: any[]; names: any[] }
const capture = (name: string): Capture => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const NBA = capture('lineups-nba-2025'); // Minnesota 2024-25 (stats id 1610612750), every 2/3/5-man unit; names: its shot_season_players rows
const MBB = capture('lineups-mbb-2025'); // Xavier 2024-25 (ESPN 2752) over the fixture's two games; names: its ncaa_player_box rows

const sdv = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()), retrieveRows: (...a: unknown[]) => sdv.fn(...a) }));
const tab = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/lineups', async (orig) => ({ ...(await orig<typeof import('../src/resources/lineups')>()), retrieveLineups: (...a: unknown[]) => tab.fn(...a) }));
vi.mock('../src/resources/onOff', async (orig) => ({ ...(await orig<typeof import('../src/resources/onOff')>()), retrieveOnOff: async () => ({ players: [], pairs: [], names: [] }) }));
vi.mock('../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../src/resources/teamSeason')>()),
    retrieveTeamSeason: async () => ({ rates: [], strength: null, games: [], gameRates: [] }),
}));
const oracle = JSON.parse(readFileSync(new URL('./fixtures/nba/league_context.json', import.meta.url)).toString());
const shots = JSON.parse(readFileSync(new URL('./fixtures/nba/shots.json', import.meta.url)).toString()) as any[];
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map((s) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result })),
}));

import LineupsTab from '../src/components/nba/LineupsTab.astro';
import { NETS_TEAM_ID } from '../src/nba/data/teams';
import { MIN_POSS, RATED, UNIT_LIMIT, type LineupRow } from '../src/resources/lineups';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { FLAGS } from '../src/utils/features';
import { generateColorRampValue } from '../src/utils/misc';
import { parseBasis, parseUnit, playerNames, unitLabels } from '../src/utils/lineups';

const MIN = 1610612750;
const XAVIER = 2752;
/** What the API answers retrieveLineups' query: the size, poss__gte the gate, order=-poss, limit (the producer's rows are already by -poss). */
const api = (c: Capture, size: number, league: 'nba' | 'mbb'): LineupRow[] =>
    c.units.filter((u) => u.n_players === size && u.poss >= MIN_POSS[league]).sort((a, b) => b.poss - a.poss).slice(0, UNIT_LIMIT);

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => {
    sdv.fn.mockReset();
    tab.fn.mockReset();
    tab.fn.mockResolvedValue({ units: [], names: [] });
});

describe('the captures (the producer table)', () => {
    test("Minnesota: each possession is one five's, so the 2- and 3-man rows are ten times the 5-man rows", () => {
        const poss = (n: number) => NBA.units.filter((u) => u.n_players === n).reduce((s, u) => s + u.poss, 0);
        expect(poss(2)).toBe(10 * poss(5));
        expect(poss(3)).toBe(10 * poss(5));
        // ranked (percentile) only over the producer's 400-possession gate (offense plus defense)
        for (const u of NBA.units) expect(u.net_rtg_pct === null).toBe(u.poss + u.opp_poss < 400);
    });
    test('Xavier over two games: no unit reaches the 200-possession rank gate, so no percentile', () => {
        expect(MBB.units.every((u) => u.net_rtg_pct === null)).toBe(true);
    });
});

describe('retrieveLineups', () => {
    const real = async () => (await vi.importActual<typeof import('../src/resources/lineups')>('../src/resources/lineups')).retrieveLineups;
    test('the NBA: one strict read of one unit size over the gate, most possessions first, capped; no name read', async () => {
        sdv.fn.mockResolvedValue(api(NBA, 3, 'nba'));
        const r = await (await real())('nba', 2025, MIN, 3);
        expect(sdv.fn).toHaveBeenCalledTimes(1);
        const [league, table, q, , strict] = sdv.fn.mock.calls[0];
        expect([league, table, strict]).toEqual(['nba', 'lineup_seasons', true]);
        expect(q).toMatchObject({ season: '2025', team_id: String(MIN), n_players: '3', poss__gte: '100', order: '-poss', limit: String(UNIT_LIMIT) });
        // every column the tab reads is selected, nothing else
        expect(q.select.split(',').sort()).toEqual(Object.keys(NBA.units[0]).sort());
        expect(r).toEqual({ units: api(NBA, 3, 'nba'), names: [] });
    });
    test("college: the units by the ESPN team id, plus the team's stats.ncaa.org names", async () => {
        sdv.fn.mockImplementation(async (_l: string, table: string) => (table === 'lineup_seasons' ? api(MBB, 2, 'mbb') : MBB.names));
        const r = await (await real())('mbb', 2025, XAVIER, 2);
        const q = Object.fromEntries(sdv.fn.mock.calls.map((c) => [c[1], c[2]]));
        expect(q.lineup_seasons).toMatchObject({ team_id: String(XAVIER), n_players: '2', poss__gte: '50' });
        expect(q.ncaa_player_box).toMatchObject({ season: '2025', team_espn_team_id: String(XAVIER), select: 'player_id,clean_name' });
        expect(sdv.fn.mock.calls.every((c) => c[4] === true)).toBe(true);
        expect(r.names).toBe(MBB.names);
    });
    test('a failed read rejects (the route turns it into the unavailable note)', async () => {
        sdv.fn.mockRejectedValue(new Error('503'));
        await expect((await real())('nba', 2025, MIN, 5)).rejects.toThrow('503');
    });
});

describe('the controls and the names', () => {
    test('?unit= and ?basis= are whitelisted; anything else is 5-man per 100', () => {
        expect([parseUnit('5'), parseUnit('3'), parseUnit('2'), parseUnit('4'), parseUnit(null), parseUnit('3x')]).toEqual([5, 3, 2, 5, 5, 5]);
        expect([parseBasis('totals'), parseBasis('per100'), parseBasis('per75'), parseBasis(null)]).toEqual(['totals', 'per100', 'per100', 'per100']);
    });
    test("Minnesota's fives, named from the season rows: five surnames each, Gobert in the most-used", () => {
        const units = api(NBA, 5, 'nba');
        const labels = unitLabels(units, playerNames(NBA.names, []));
        expect(labels).toHaveLength(units.length);
        expect(labels.every((l) => l.short.split(' · ').length === 5 && l.full.split(', ').length === 5)).toBe(true);
        expect(labels[0].full).toContain('Rudy Gobert');
        expect(labels[0].short).toContain('Gobert');
    });
    test("Xavier's pairs, named from ncaa_player_box (text ids); an id with no name reads #id", () => {
        const units = api(MBB, 2, 'mbb');
        const named = unitLabels(units, playerNames([], MBB.names));
        expect(named.every((l) => !l.full.includes('#'))).toBe(true);
        expect(named.some((l) => l.full.includes('Dayvion McKnight'))).toBe(true);
        expect(unitLabels(units.slice(0, 1), new Map())[0].short).toBe(`#${units[0].player_1} · #${units[0].player_2}`);
    });
});

function fakeAstro(locals: Record<string, unknown>, search = '?season=2026', id = String(NETS_TEAM_ID)) {
    const cache: unknown[] = [];
    const headers = new Headers();
    const url = new URL(`https://gameonpaper.com/nba/team/${id}${search}`);
    return { astro: { params: { id }, url, locals, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const ok = (r: Awaited<ReturnType<typeof prepareNbaTeam>>) => { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r; };

describe('prepareNbaTeam with the flag', () => {
    test("'bball-lineups' is a preview flag", () => { expect(FLAGS['bball-lineups']).toBe('preview'); });
    test("off (no preview): no read, no lineups key, so the page is byte for byte today's", async () => {
        const r = ok(await prepareNbaTeam(fakeAstro({}).astro));
        expect(tab.fn).not.toHaveBeenCalled();
        expect('lineups' in r).toBe(false);
    });
    test('on: the 5-man per-100 default, keyed by the stats team id, the page cached as before', async () => {
        const { astro, cache } = fakeAstro({ preview: true });
        const r = ok(await prepareNbaTeam(astro));
        expect(tab.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, 5);
        expect(r.lineups).toEqual({ unit: 5, basis: 'per100', units: [], labels: [] });
        expect(cache).toHaveLength(1);
        expect(cache[0]).not.toBe(false);
    });
    test('?unit=2&basis=totals reads the pairs; the units are named from the season rows', async () => {
        const rows = apiSeasonPlayerRows().filter((p: any) => p.team_id === NETS_TEAM_ID);
        const pair = { ...NBA.units.find((u) => u.n_players === 2), player_1: rows[0].person_id, player_2: rows[1].person_id };
        tab.fn.mockResolvedValue({ units: [pair], names: [] });
        const r = ok(await prepareNbaTeam(fakeAstro({ preview: true }, '?season=2026&unit=2&basis=totals').astro));
        expect(tab.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, 2);
        expect(r.lineups!.basis).toBe('totals');
        expect(r.lineups!.labels[0].full).toBe(`${rows[0].player_name}, ${rows[1].player_name}`);
    });
    test('on, a 404 spends no read', async () => {
        expect(await prepareNbaTeam(fakeAstro({ preview: true }, '?season=2026', '1').astro)).toEqual({ notFound: true });
        expect(tab.fn).not.toHaveBeenCalled();
    });
    test('on, a failed read: the page renders, the units are null, nothing is cached', async () => {
        tab.fn.mockRejectedValueOnce(new Error('down'));
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = ok(await prepareNbaTeam(astro));
        expect(r.lineups).toEqual({ unit: 5, basis: 'per100', units: null, labels: [] });
        expect(r.dashboard).not.toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

const BASE = `/nba/team/${MIN}`;
const render = (league: 'nba' | 'mbb', c: Capture, unit: 5 | 3 | 2, basis: 'per100' | 'totals', units: LineupRow[] | null = api(c, unit, league)) =>
    container.renderToString(LineupsTab, {
        props: { data: { unit, basis, units, labels: units ? unitLabels(units, league === 'nba' ? playerNames(c.names, []) : playerNames([], c.names)) : [] }, season: 2025, current: 2026, basePath: BASE, teamName: 'Team' },
        locals: { league } as App.Locals,
    });
const rowsOf = (html: string) => html.split('id="lineups-table"')[1].split('<tbody>')[1].split('</tbody>')[0].match(/<tr/g)?.length ?? 0;

describe('LineupsTab', () => {
    test("Minnesota's fives per 100: one row per unit over the gate, the producer's ratings, shaded where ranked", async () => {
        const units = api(NBA, 5, 'nba');
        const html = await render('nba', NBA, 5, 'per100');
        expect(units.length).toBe(13);
        expect(rowsOf(html)).toBe(13);
        expect(html).toContain('>ORtg<');
        expect(html).toContain('>Opp FT rate<');
        expect(html).toContain(units[0].off_rtg!.toFixed(1));
        expect(html).toContain('Gobert');
        // a cell is shaded by its producer percentile on the site's ramp (whose two middle steps are plain), so only ranked units
        const pcts = units.flatMap((u) => RATED.map((m) => u[`${m}_pct`])).filter((p) => generateColorRampValue(p, 100) !== null);
        expect(pcts.length).toBeGreaterThan(0);
        expect(html.match(/hulk-bg-level-\d/g)!.length).toBe(pcts.length);
        expect(html).toContain('13 5-man units, each with at least 100 on offense.');
        for (const bad of ['undefined', 'NaN', '>#']) expect(html).not.toContain(bad);
    });
    test('totals: possessions, points and the plus-minus, nothing shaded', async () => {
        const units = api(NBA, 5, 'nba');
        const html = await render('nba', NBA, 5, 'totals');
        expect(html).toContain('>+/-<');
        expect(html).not.toContain('>ORtg<');
        expect(html).toContain(`>${units[0].plus_minus > 0 ? '+' : ''}${units[0].plus_minus}<`);
        expect(html).toContain(`>${units[0].opp_pts.toLocaleString('en-US')}<`);
        expect(html).not.toMatch(/hulk-bg-level-\d/);
    });
    test('the 3-man list past the cap says it is the top of the list', async () => {
        expect(NBA.units.filter((u) => u.n_players === 3 && u.poss >= 100).length).toBeGreaterThan(UNIT_LIMIT);
        const html = await render('nba', NBA, 3, 'per100');
        expect(rowsOf(html)).toBe(UNIT_LIMIT);
        expect(html).toContain(`The ${UNIT_LIMIT} 3-man units with the most possessions`);
    });
    test('the two selects are URLs: each keeps the season and the other control, defaults dropped, to the tab', async () => {
        const html = await render('nba', NBA, 3, 'totals');
        const opts = (id: string) => [...html.split(`id="${id}"`)[1].split('</select>')[0].matchAll(/<option value="([^"]+)"( selected)?/g)].map((m) => [m[1].replaceAll('&amp;', '&'), !!m[2]]);
        expect(opts('lineups-unit')).toEqual([
            [`${BASE}?season=2025&basis=totals#lineups`, false],
            [`${BASE}?season=2025&unit=3&basis=totals#lineups`, true],
            [`${BASE}?season=2025&unit=2&basis=totals#lineups`, false],
        ]);
        expect(opts('lineups-basis')).toEqual([[`${BASE}?season=2025&unit=3#lineups`, false], [`${BASE}?season=2025&unit=3&basis=totals#lineups`, true]]);
        expect(html.match(/onchange="window.location.href = this.value"/g)).toHaveLength(2);
    });
    test('Xavier: the pairs over the college gate, named, unshaded; no five reaches it, which the tab says', async () => {
        const html = await render('mbb', MBB, 2, 'per100');
        expect(rowsOf(html)).toBe(15);
        expect(html).toContain('McKnight');
        expect(html).not.toMatch(/hulk-bg-level-\d/);
        const five = await render('mbb', MBB, 5, 'per100');
        expect(five).toContain('id="lineups-empty"');
        expect(five).toContain('No Team 5-man unit has 50 possessions in 2024-25 yet.');
        expect(five).toContain('id="lineups-unit"'); // the controls stay, so another size is one pick away
    });
    test('the table before the backfill (no rows) is the empty note; a failed read says unavailable', async () => {
        expect(await render('nba', NBA, 5, 'per100', [])).toContain('id="lineups-empty"');
        const down = await render('nba', NBA, 5, 'per100', null);
        expect(down).toContain('id="lineups-unavailable"');
        expect(down).not.toContain('id="lineups-table"');
    });
});
