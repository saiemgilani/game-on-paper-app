// BB-G4: the team page's On/Off and WOWY section behind 'bball-on-off'. The reads' queries, the WOWY pick and its
// orientation, the page-side step (the flag gates the reads; a failed read keeps the page and is never cached) and the
// template, on sdv-db's committed player_on_off / player_wowy fixtures: sdv-py's nba_ / mbb_player_on_off and _wowy over
// real games (fixtures/README.md: on-off-*-2025.json.gz). The names are the lineups captures'. Every Data API read is mocked.
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

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
interface Capture { players: any[]; pairs: any[] }
const NBA: Capture = gz('on-off-nba-2025'); // Minnesota 2024-25 (stats id 1610612750), its whole regular season
const MBB: Capture = gz('on-off-mbb-2025'); // Xavier 2024-25 (ESPN 2752) over the fixture's two games
const NBA_NAMES: any[] = gz('lineups-nba-2025').names; // Minnesota's shot_season_players rows
const MBB_NAMES: any[] = gz('lineups-mbb-2025').names; // Xavier's ncaa_player_box rows

const sdv = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()), retrieveRows: (...a: unknown[]) => sdv.fn(...a) }));
const reads = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/onOff', async (orig) => ({ ...(await orig<typeof import('../src/resources/onOff')>()), retrieveOnOff: (...a: unknown[]) => reads.fn(...a) }));
vi.mock('../src/resources/lineups', async (orig) => ({ ...(await orig<typeof import('../src/resources/lineups')>()), retrieveLineups: async () => ({ units: [], names: [] }) }));
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

import OnOffTab from '../src/components/nba/OnOffTab.astro';
import { NETS_TEAM_ID } from '../src/nba/data/teams';
import { PAIR_LIMIT, PLAYER_LIMIT, RATINGS } from '../src/resources/onOff';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { FLAGS } from '../src/utils/features';
import { playerNames } from '../src/utils/lineups';
import { generateColorRampValue } from '../src/utils/misc';
import { parseWowy, wowyLines, type OnOffTab as Tab } from '../src/utils/onOff';

const MIN = 1610612750;
const XAVIER = 2752;
const EDWARDS = '1630162'; // Minnesota's most minutes on the floor

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => {
    sdv.fn.mockReset();
    reads.fn.mockReset();
    reads.fn.mockResolvedValue({ players: [], pairs: [], names: [] });
});

describe('the captures (the producer tables)', () => {
    test("on + off is the team's whole season for every player, whatever games he played", () => {
        for (const c of [NBA, MBB]) {
            expect(new Set(c.players.map((p) => p.poss_on + p.poss_off)).size).toBe(1);
            const team = c.players[0].minutes_on + c.players[0].minutes_off;
            for (const p of c.players) expect(p.minutes_on + p.minutes_off).toBeCloseTo(team, 3);
        }
        // Minnesota's 82 games; a player who missed games or came mid-season still has the whole season off
        expect(NBA.players.map((p) => p.team_games)).toEqual(Array(20).fill(82));
        expect(NBA.players.some((p) => p.games < 41)).toBe(true);
    });
    test("each pair's four splits add up to the team's minutes", () => {
        const team = NBA.players[0].minutes_on + NBA.players[0].minutes_off;
        expect(NBA.pairs).toHaveLength((20 * 19) / 2);
        for (const r of NBA.pairs) expect(r.minutes_both + r.minutes_a_only + r.minutes_b_only + r.minutes_neither).toBeCloseTo(team, 3);
    });
    test('ranked over the rank gate only: 14 of Minnesota\'s 20 players, none of Xavier\'s over two games', () => {
        expect(NBA.players.filter((p) => p.net_rtg_on_pct !== null)).toHaveLength(14);
        expect(MBB.players.every((p) => p.net_rtg_on_pct === null && p.net_rtg_diff_pct === null)).toBe(true);
    });
});

describe('retrieveOnOff', () => {
    const real = async () => (await vi.importActual<typeof import('../src/resources/onOff')>('../src/resources/onOff')).retrieveOnOff;
    test('the NBA: two strict reads of the team-season, the players by minutes on, every pair; no name read', async () => {
        sdv.fn.mockImplementation(async (_l: string, table: string) => (table === 'player_on_off' ? NBA.players : NBA.pairs));
        const r = await (await real())('nba', 2025, MIN);
        expect(sdv.fn).toHaveBeenCalledTimes(2);
        const q = Object.fromEntries(sdv.fn.mock.calls.map((c) => [c[1], c[2]]));
        expect(sdv.fn.mock.calls.every((c) => c[0] === 'nba' && c[4] === true)).toBe(true);
        expect(q.player_on_off).toMatchObject({ season: '2025', team_id: String(MIN), order: '-minutes_on', limit: String(PLAYER_LIMIT) });
        expect(q.player_wowy).toMatchObject({ season: '2025', team_id: String(MIN), limit: String(PAIR_LIMIT) });
        // every column the section reads is selected, nothing else
        expect(q.player_on_off.select.split(',').sort()).toEqual(Object.keys(NBA.players[0]).sort());
        expect(q.player_wowy.select.split(',').sort()).toEqual(Object.keys(NBA.pairs[0]).sort());
        expect(r).toEqual({ players: NBA.players, pairs: NBA.pairs, names: [] });
    });
    test("college: by the ESPN team id, plus the team's stats.ncaa.org names", async () => {
        sdv.fn.mockImplementation(async (_l: string, table: string) => ({ player_on_off: MBB.players, player_wowy: MBB.pairs, ncaa_player_box: MBB_NAMES } as any)[table]);
        const r = await (await real())('mbb', 2025, XAVIER);
        const q = Object.fromEntries(sdv.fn.mock.calls.map((c) => [c[1], c[2]]));
        expect(q.player_on_off).toMatchObject({ team_id: String(XAVIER) });
        expect(q.ncaa_player_box).toMatchObject({ season: '2025', team_espn_team_id: String(XAVIER), select: 'player_id,clean_name' });
        expect(r.names).toBe(MBB_NAMES);
    });
    test('a failed read rejects (the route turns it into the unavailable note)', async () => {
        sdv.fn.mockRejectedValue(new Error('503'));
        await expect((await real())('nba', 2025, MIN)).rejects.toThrow('503');
    });
});

describe('the WOWY pick', () => {
    test("?wowy= is one of the team's players; anything else is the one with the most minutes", () => {
        expect(parseWowy(null, NBA.players)).toBe(EDWARDS);
        expect(parseWowy('203497', NBA.players)).toBe('203497');
        expect(parseWowy('1', NBA.players)).toBe(EDWARDS);
        expect(parseWowy('203497', [])).toBe(null);
    });
    test("each teammate read from the player's side: together + without is his minutes on, together + teammate-only the teammate's", () => {
        const on = new Map(NBA.players.map((p) => [String(p.player_id), p.minutes_on]));
        for (const who of [EDWARDS, String(NBA.players.at(-1).player_id)]) {
            const lines = wowyLines(NBA.pairs, who);
            expect(lines).toHaveLength(19);
            for (const l of lines) {
                expect(l.together.minutes + l.without.minutes).toBeCloseTo(on.get(who)!, 3);
                expect(l.together.minutes + l.mateOnly.minutes).toBeCloseTo(on.get(l.teammate)!, 3);
            }
            expect(lines.map((l) => l.together.minutes)).toEqual([...lines.map((l) => l.together.minutes)].sort((a, b) => b - a));
        }
        expect(wowyLines(NBA.pairs, null)).toEqual([]);
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
    test("'bball-on-off' is a preview flag", () => { expect(FLAGS['bball-on-off']).toBe('preview'); });
    test('off (no preview): no read, no onOff key, so the page is byte for byte today\'s', async () => {
        const r = ok(await prepareNbaTeam(fakeAstro({}).astro));
        expect(reads.fn).not.toHaveBeenCalled();
        expect('onOff' in r).toBe(false);
    });
    test('on: keyed by the stats team id; the table before the backfill is empty, the page cached as before', async () => {
        const { astro, cache } = fakeAstro({ preview: true });
        const r = ok(await prepareNbaTeam(astro));
        expect(reads.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID);
        expect(r.onOff).toMatchObject({ players: [], wowy: null, lines: [] });
        expect(cache).toHaveLength(1);
        expect(cache[0]).not.toBe(false);
    });
    test('?wowy= picks the player; the names are the season rows', async () => {
        const rows = apiSeasonPlayerRows().filter((p: any) => p.team_id === NETS_TEAM_ID);
        const [a, b] = rows.map((p: any) => p.person_id);
        const players = [{ ...NBA.players[0], player_id: a }, { ...NBA.players[1], player_id: b }];
        reads.fn.mockResolvedValue({ players, pairs: [{ ...NBA.pairs[0], player_id_a: Math.min(a, b), player_id_b: Math.max(a, b) }], names: [] });
        const r = ok(await prepareNbaTeam(fakeAstro({ preview: true }, `?season=2026&wowy=${b}`).astro));
        expect(r.onOff!.wowy).toBe(String(b));
        expect(r.onOff!.lines.map((l) => l.teammate)).toEqual([String(a)]);
        expect(r.onOff!.names.get(String(a))).toBe(rows[0].player_name);
    });
    test('on, a 404 spends no read', async () => {
        expect(await prepareNbaTeam(fakeAstro({ preview: true }, '?season=2026', '1').astro)).toEqual({ notFound: true });
        expect(reads.fn).not.toHaveBeenCalled();
    });
    test('on, a failed read: the page renders, the players are null, nothing is cached', async () => {
        reads.fn.mockRejectedValueOnce(new Error('down'));
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = ok(await prepareNbaTeam(astro));
        expect(r.onOff).toMatchObject({ players: null, wowy: null, lines: [] });
        expect(r.dashboard).not.toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

const BASE = `/nba/team/${MIN}`;
const tabOf = (c: Capture, names: Map<string, string>, wowy: string | null = null): Tab => {
    const w = parseWowy(wowy, c.players);
    return { players: c.players, names, wowy: w, lines: wowyLines(c.pairs, w) };
};
const render = (league: 'nba' | 'mbb', data: Tab) =>
    container.renderToString(OnOffTab, { props: { data, season: 2025, current: 2026, basePath: BASE, teamName: 'Team' }, locals: { league } as App.Locals });
const rowsOf = (html: string, id: string) => html.split(`id="${id}"`)[1].split('<tbody>')[1].split('</tbody>')[0].match(/<tr/g)?.length ?? 0;
const NBA_TAB = () => tabOf(NBA, playerNames(NBA_NAMES, []));

describe('OnOffTab', () => {
    test("Minnesota: one row per player, the producer's ratings, shaded only where ranked, the whole-season note", async () => {
        const html = await render('nba', NBA_TAB());
        expect(rowsOf(html, 'on-off-table')).toBe(20);
        expect(html).toContain('Anthony Edwards');
        expect(html).toContain(NBA.players[0].off_rtg_on.toFixed(1));
        expect(html).toContain(NBA.players[0].def_rtg_off.toFixed(1));
        // the off side is the team's whole season, which stats.nba.com's is not
        expect(html).toContain('all 82 of its games, including any before the player joined');
        expect(html).toContain('So on plus off is always the team\'s whole season.');
        expect(html).toContain('stats.nba.com counts the off side only while the player was on the roster');
        // a cell is shaded by its producer percentile on the site's ramp (on and diff only; the two middle steps are plain)
        const pcts = NBA.players.flatMap((p) => (['on', 'diff'] as const).flatMap((s) => RATINGS.map((m) => p[`${m}_${s}_pct`]))).filter((p) => generateColorRampValue(p, 100) !== null);
        expect(pcts.length).toBeGreaterThan(0);
        expect(html.split('id="wowy"')[0].match(/hulk-bg-level-\d/g)!.length).toBe(pcts.length);
        // a player with no shot is not in the season rows: his id stands in for the name
        expect(html).toContain('#1642399');
        for (const bad of ['undefined', 'NaN']) expect(html).not.toContain(bad);
    });
    test("WOWY: Edwards by default, against his 19 teammates, unshaded; the select's URLs keep the season and drop the default", async () => {
        const html = await render('nba', NBA_TAB());
        const wowy = html.split('id="wowy"')[1];
        expect(rowsOf(wowy, 'wowy-table')).toBe(19);
        expect(wowy).toContain('Anthony Edwards without');
        expect(wowy).not.toMatch(/hulk-bg-level-\d/);
        const opts = [...wowy.split('id="wowy-player"')[1].split('</select>')[0].matchAll(/<option value="([^"]+)"( selected)?/g)].map((m) => [m[1].replaceAll('&amp;', '&'), !!m[2]]);
        expect(opts).toHaveLength(20);
        expect(opts[0]).toEqual([`${BASE}?season=2025#wowy`, true]);
        expect(opts[1]).toEqual([`${BASE}?season=2025&wowy=${NBA.players[1].player_id}#wowy`, false]);
        // the top line is the teammate he shared the most minutes with, read from his side
        const top = wowyLines(NBA.pairs, EDWARDS)[0];
        expect(wowy.split('<tbody>')[1]).toMatch(new RegExp(`^\\s*<tr[^>]*>\\s*<th[^>]*>${NBA_NAMES.find((n) => String(n.person_id) === top.teammate).player_name}</th>\\s*<td[^>]*>${Math.round(top.together.minutes).toLocaleString('en-US')}</td>`));
    });
    test("Xavier: named from ncaa_player_box, nothing shaded, and no stats.nba.com sentence", async () => {
        const html = await render('mbb', tabOf(MBB, playerNames([], MBB_NAMES)));
        expect(rowsOf(html, 'on-off-table')).toBe(14);
        expect(rowsOf(html.split('id="wowy"')[1], 'wowy-table')).toBe(13);
        expect(html).not.toMatch(/hulk-bg-level-\d/);
        expect(html).not.toContain('>#');
        expect(html).toContain('all 2 of its games');
        expect(html).not.toContain('stats.');
    });
    test('the table before the backfill (no rows) is the empty note; a failed read says unavailable', async () => {
        const empty = await render('nba', { players: [], names: new Map(), wowy: null, lines: [] });
        expect(empty).toContain('id="on-off-empty"');
        expect(empty).toContain('No Team on/off numbers for 2024-25 yet.');
        expect(empty).not.toContain('id="wowy"');
        const down = await render('nba', { players: null, names: new Map(), wowy: null, lines: [] });
        expect(down).toContain('id="on-off-unavailable"');
        expect(down).not.toContain('id="on-off-table"');
    });
});
