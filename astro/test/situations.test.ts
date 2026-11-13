// BB-G25: the team page's Situations section behind 'bball-situational'. The reads' queries, the control's options and
// whitelist, the page-side step (the flag gates the reads; a failed read keeps the page and is never cached; no rows yet is
// the empty note) and the template, on sdv-db's committed situational fixtures: sdv-py's nba_situational_* /
// mbb_situational_* over real games (fixtures/README.md: situations-*.json.gz). Every Data API read is mocked.
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

interface Capture { team: any[]; players: any[]; lineups: any[]; names: any[] }
const capture = (name: string): Capture => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const NBA = capture('situations-nba-2024'); // Minnesota 2023-24 (stats id 1610612750); names: its shot_season_players rows
const MBB = capture('situations-mbb-2025'); // Michigan State 2024-25 (ESPN 127); names: its ncaa_player_box rows
/** One player's live split rows (2026-11-13): Anthony Edwards with Minnesota, and Cameron Boozer with Duke plus his crosswalk pair. */
const PLAYER = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/situations-player-2026.json.gz', import.meta.url))).toString());

const sdv = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()), retrieveRows: (...a: unknown[]) => sdv.fn(...a) }));
const sit = vi.hoisted(() => ({ fn: vi.fn() }));
const psit = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/situational', async (orig) => ({ ...(await orig<typeof import('../src/resources/situational')>()), retrieveSituational: (...a: unknown[]) => sit.fn(...a), retrievePlayerSituational: (...a: unknown[]) => psit.fn(...a) }));
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

import PlayerSituations from '../src/components/nba/PlayerSituations.astro';
import SituationsTab from '../src/components/nba/SituationsTab.astro';
import { NETS_TEAM_ID } from '../src/nba/data/teams';
import { UNIT_LIMIT, type SituationalReads } from '../src/resources/situational';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { FLAGS } from '../src/utils/features';
import { playerNames, unitLabels } from '../src/utils/lineups';
import { nameRows, parseSituation, PLAYER_MIN_POSS, situationsFor, teamRows, UNIT_MIN_POSS, type Situation } from '../src/utils/situations';

const MIN = 1610612750;
const MSU = 127;
/** What the API answers retrieveSituational's queries: the team's split rows; the situation's players (10+ poss) and units (25+) by -poss, capped. */
const api = (c: Capture, s: Pick<Situation, 'family' | 'split'>): SituationalReads => {
    const one = (rows: any[], min: number, cap: number) => rows.filter((r) => r.family === s.family && r.split === s.split && r.poss >= min).sort((a, b) => b.poss - a.poss).slice(0, cap);
    return { team: c.team, players: one(c.players, PLAYER_MIN_POSS, 40), units: one(c.lineups, UNIT_MIN_POSS, UNIT_LIMIT), names: c.names };
};

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => {
    sdv.fn.mockReset();
    sit.fn.mockReset();
    sit.fn.mockResolvedValue({ team: [], players: [], units: [], names: [] });
    psit.fn.mockReset();
    psit.fn.mockResolvedValue([]);
});

describe('the captures (the producer tables)', () => {
    test('within a family the team splits add up to the all row (sdv-db docs: the add-up)', () => {
        for (const c of [NBA, MBB]) {
            const all = c.team.find((r) => r.family === 'all')!;
            for (const fam of ['clutch', 'period', 'score', 'garbage', 'opponent']) {
                const rows = c.team.filter((r) => r.family === fam);
                expect(rows.reduce((s, r) => s + r.poss, 0)).toBe(all.poss);
                expect(rows.reduce((s, r) => s + r.plus_minus, 0)).toBe(all.plus_minus);
            }
        }
    });
    test("the lineup table keeps the units with 50 possessions in the season (offense plus defense), every split of each", () => {
        for (const c of [NBA, MBB]) {
            const all = c.lineups.filter((u) => u.family === 'all');
            expect(all.every((u) => u.poss + u.opp_poss >= 50)).toBe(true);
            expect(new Set(c.lineups.map((u) => u.lineup_id))).toEqual(new Set(all.map((u) => u.lineup_id)));
        }
    });
});

describe('retrieveSituational', () => {
    const real = async () => (await vi.importActual<typeof import('../src/resources/situational')>('../src/resources/situational')).retrieveSituational;
    test("the NBA: the team's split rows, and the situation's players and units, most possessions first; strict; no name read", async () => {
        sdv.fn.mockResolvedValue([]);
        await (await real())('nba', 2024, MIN, 'clutch', 'clutch');
        const q = Object.fromEntries(sdv.fn.mock.calls.map((c) => [c[1], c[2]]));
        expect(Object.keys(q).sort()).toEqual(['situational_lineup', 'situational_player', 'situational_team']);
        expect(sdv.fn.mock.calls.every((c) => c[0] === 'nba' && c[4] === true)).toBe(true);
        expect(q.situational_team).toMatchObject({ season: '2024', team_id: String(MIN), limit: '40' });
        expect(q.situational_team.family).toBeUndefined();
        expect(q.situational_player).toMatchObject({ season: '2024', team_id: String(MIN), family: 'clutch', split: 'clutch', order: '-poss', poss__gte: '10', limit: '40' });
        expect(q.situational_lineup).toMatchObject({ family: 'clutch', split: 'clutch', order: '-poss', poss__gte: '25', limit: String(UNIT_LIMIT) });
        expect(q.situational_team.poss__gte).toBeUndefined();
        // every column the section reads is selected, nothing else
        const cols = (rows: any[]) => Object.keys(rows[0]).filter((k) => k !== 'team_id').sort();
        expect(q.situational_team.select.split(',').sort()).toEqual(cols(NBA.team));
        expect(q.situational_player.select.split(',').sort()).toEqual(cols(NBA.players));
        expect(q.situational_lineup.select.split(',').sort()).toEqual(cols(NBA.lineups));
    });
    test("college: by the ESPN team id, plus the team's stats.ncaa.org names", async () => {
        sdv.fn.mockImplementation(async (_l: string, table: string) => (table === 'ncaa_player_box' ? MBB.names : []));
        const r = await (await real())('mbb', 2025, MSU, 'period', 'ot');
        const q = Object.fromEntries(sdv.fn.mock.calls.map((c) => [c[1], c[2]]));
        expect(q.situational_player).toMatchObject({ team_id: String(MSU), family: 'period', split: 'ot' });
        expect(q.ncaa_player_box).toMatchObject({ season: '2025', team_espn_team_id: String(MSU), select: 'player_id,clean_name' });
        expect(r.names).toBe(MBB.names);
    });
    test('a failed read rejects (the route turns it into the unavailable note)', async () => {
        sdv.fn.mockRejectedValue(new Error('503'));
        await expect((await real())('nba', 2024, MIN, 'all', 'all')).rejects.toThrow('503');
    });
});

describe('retrievePlayerSituational (the player page)', () => {
    const real = async () => (await vi.importActual<typeof import('../src/resources/situational')>('../src/resources/situational')).retrievePlayerSituational;
    test("a pro: one strict read of his rows with his team, every split over 10 possessions, the team table's columns", async () => {
        sdv.fn.mockResolvedValue(PLAYER.nba.rows);
        const rows = await (await real())('nba', 2026, PLAYER.nba.person_id, PLAYER.nba.team_id);
        expect(sdv.fn).toHaveBeenCalledTimes(1);
        const [league, table, q, , strict] = sdv.fn.mock.calls[0];
        expect([league, table, strict]).toEqual(['nba', 'situational_player', true]);
        expect(q).toMatchObject({ season: '2026', team_id: String(MIN), player_id: '1630162', poss__gte: '10', limit: '40' });
        expect(q.family).toBeUndefined();
        expect(q.select.split(',').sort()).toEqual(Object.keys(PLAYER.nba.rows[0]).sort());
        expect(rows).toBe(PLAYER.nba.rows);
    });
    test("college: his ESPN athlete id to the season's stats.ncaa.org id (the crosswalk), then his rows; no pair, no rows", async () => {
        sdv.fn.mockImplementation(async (_l: string, table: string) => (table === 'ncaa_player_crosswalk' ? PLAYER.mbb.crosswalk : PLAYER.mbb.rows));
        const rows = await (await real())('mbb', 2026, PLAYER.mbb.person_id, PLAYER.mbb.team_id);
        const q = Object.fromEntries(sdv.fn.mock.calls.map((c) => [c[1], c[2]]));
        expect(q.ncaa_player_crosswalk).toMatchObject({ season: '2026', espn_athlete_id: '5041935', select: 'ncaa_player_id' });
        expect(q.situational_player).toMatchObject({ season: '2026', team_id: '150', player_id: '11195975', poss__gte: '10' });
        expect(rows).toBe(PLAYER.mbb.rows);
        sdv.fn.mockReset();
        sdv.fn.mockResolvedValue([]);
        expect(await (await real())('mbb', 2026, 1, 150)).toEqual([]);
        expect(sdv.fn.mock.calls.map((c) => c[1])).toEqual(['ncaa_player_crosswalk']);
    });
});

describe('the control', () => {
    const keys = (o: Situation[]) => o.map((s) => s.key);
    test('the NBA: All, Clutch, four quarters and overtime, Leading, Tied, Trailing, Home, Away, Transition, Half court, Second chance, Garbage time out, vs top 10', () => {
        const o = situationsFor('nba', 2024);
        expect(keys(o)).toEqual(['all', 'clutch', 'p1', 'p2', 'p3', 'p4', 'ot', 'leading', 'tied', 'trailing', 'home', 'away', 'transition', 'half_court', 'second_chance', 'not_garbage_time', 'vs_top']);
        expect(o.map((s) => s.label)).toEqual(['All', 'Clutch', '1st quarter', '2nd quarter', '3rd quarter', '4th quarter', 'Overtime', 'Leading', 'Tied', 'Trailing', 'Home', 'Away', 'Transition', 'Half court', 'Second chance', 'Garbage time out', 'vs top 10']);
        expect(o.filter((s) => ['tied', 'home', 'away', 'transition', 'half_court', 'second_chance'].includes(s.key)).map((s) => `${s.family}/${s.split}`)).toEqual(['score/tied', 'venue/home', 'venue/away', 'play_type/transition', 'play_type/half_court', 'chance/second_chance']);
        expect(o.find((s) => s.key === 'ot')!.note).toBe('Possessions that start in overtime.');
        // every option is a (family, split) the producer writes
        for (const s of o) expect(NBA.team.some((r) => r.family === s.family && r.split === s.split)).toBe(true);
    });
    test('college: two halves (the producer\'s p1 / p2), vs top 25; the WNBA: halves through 2005, quarters from 2006, vs top 4', () => {
        const m = situationsFor('mbb', 2025);
        expect(keys(m)).toEqual(['all', 'clutch', 'p1', 'p2', 'ot', 'leading', 'tied', 'trailing', 'home', 'away', 'transition', 'half_court', 'not_garbage_time', 'vs_top']);
        expect(m.find((s) => s.key === 'p2')!.label).toBe('2nd half');
        expect(m.at(-1)!.label).toBe('vs top 25');
        for (const s of m) expect(MBB.team.some((r) => r.family === s.family && r.split === s.split)).toBe(true);
        expect(keys(situationsFor('wnba', 2005)).filter((k) => /^p\d$/.test(k))).toEqual(['p1', 'p2']);
        expect(keys(situationsFor('wnba', 2006)).filter((k) => /^p\d$/.test(k))).toEqual(['p1', 'p2', 'p3', 'p4']);
        expect(situationsFor('wnba', 2026).at(-1)!.label).toBe('vs top 4');
        expect(keys(situationsFor('wbb', 2015)).filter((k) => /^p\d$/.test(k))).toEqual(['p1', 'p2']);
        // Second chance is the pros' only: college publishes no chance rows (the MBB fixture has none)
        expect(MBB.team.some((r) => r.family === 'chance')).toBe(false);
        expect(keys(situationsFor('wnba', 2025))).toContain('second_chance');
        for (const l of ['mbb', 'wbb'] as const) expect(keys(situationsFor(l, 2026))).not.toContain('second_chance');
    });
    test('?situation= is whitelisted: anything else (a family the control does not offer, junk, none) is All', () => {
        const o = situationsFor('nba', 2024);
        expect(['clutch', 'p3', 'vs_top', 'transition', 'second_chance', 'h1', 'neutral', 'p5', 'CLUTCH', null].map((v) => parseSituation(v, o).key)).toEqual(['clutch', 'p3', 'vs_top', 'transition', 'second_chance', 'all', 'all', 'all', 'all', 'all']);
        expect(parseSituation('second_chance', situationsFor('mbb', 2025)).key).toBe('all');
    });
    test("the team table: the situation's row then All; All alone for All, or when the team has no row in the situation", () => {
        const o = situationsFor('nba', 2024);
        const clutch = teamRows(NBA.team.filter((r) => r.team_id === MIN), parseSituation('clutch', o));
        expect(clutch.map((r) => r.split)).toEqual(['clutch', 'all']);
        expect(teamRows(NBA.team, o[0]).map((r) => r.split)).toEqual(['all']);
        expect(teamRows(NBA.team.filter((r) => r.split !== 'ot'), parseSituation('ot', o)).map((r) => r.split)).toEqual(['all']);
        expect(teamRows([], o[1])).toEqual([]);
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
    test("'bball-situational' is a preview flag", () => { expect(FLAGS['bball-situational']).toBe('preview'); });
    test('off (no preview): no read, no situations key, so the page is byte for byte today\'s', async () => {
        const r = ok(await prepareNbaTeam(fakeAstro({}).astro));
        expect(sit.fn).not.toHaveBeenCalled();
        expect('situations' in r).toBe(false);
    });
    test('on: All by default, keyed by the stats team id; before the backfill (no rows) the page renders and is cached as before', async () => {
        const { astro, cache } = fakeAstro({ preview: true });
        const r = ok(await prepareNbaTeam(astro));
        expect(sit.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, 'all', 'all');
        expect(r.situations!.situation.key).toBe('all');
        expect(r.situations!.reads).toEqual({ team: [], players: [], units: [], names: [] });
        expect(cache).toHaveLength(1);
        expect(cache[0]).not.toBe(false);
    });
    test('?situation=p4 reads the 4th quarter; the players and the units are named from the season rows', async () => {
        const rows = apiSeasonPlayerRows().filter((p: any) => p.team_id === NETS_TEAM_ID);
        const player = { ...NBA.players[0], player_id: rows[0].person_id };
        const unit = { ...NBA.lineups[0], player_1: rows[0].person_id, player_2: rows[1].person_id, player_3: 1, player_4: 2, player_5: 3 };
        sit.fn.mockResolvedValue({ team: [], players: [player], units: [unit], names: [] });
        const r = ok(await prepareNbaTeam(fakeAstro({ preview: true }, '?season=2026&situation=p4').astro));
        expect(sit.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, 'period', 'p4');
        expect(r.situations!.playerNames).toEqual([rows[0].player_name]);
        expect(r.situations!.unitLabels[0].full).toBe(`${rows[0].player_name}, ${rows[1].player_name}, #1, #2, #3`);
    });
    test('?situation= junk reads All; Second chance reads the chance family', async () => {
        await prepareNbaTeam(fakeAstro({ preview: true }, '?season=2026&situation=first_chance').astro);
        expect(sit.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, 'all', 'all');
        sit.fn.mockClear();
        await prepareNbaTeam(fakeAstro({ preview: true }, '?season=2026&situation=second_chance').astro);
        expect(sit.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, 'chance', 'second_chance');
    });
    test('on, a 404 spends no read', async () => {
        expect(await prepareNbaTeam(fakeAstro({ preview: true }, '?season=2026', '1').astro)).toEqual({ notFound: true });
        expect(sit.fn).not.toHaveBeenCalled();
    });
    test('on, a failed read: the page renders, the reads are null, nothing is cached', async () => {
        sit.fn.mockRejectedValueOnce(new Error('down'));
        const { astro, cache, headers } = fakeAstro({ preview: true }, '?season=2026&situation=clutch');
        const r = ok(await prepareNbaTeam(astro));
        expect(r.situations!.reads).toBeNull();
        expect(r.situations!.situation.key).toBe('clutch');
        expect(r.dashboard).not.toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

const BASE = `/nba/team/${MIN}`;
const render = (league: 'nba' | 'mbb', c: Capture, season: number, key: string, reads?: SituationalReads | null) => {
    const options = situationsFor(league, season);
    const situation = parseSituation(key, options);
    const r = reads === undefined ? api(c, situation) : reads;
    const names = r ? (league === 'nba' ? playerNames(c.names, []) : playerNames([], c.names)) : new Map();
    return container.renderToString(SituationsTab, {
        props: { data: { situation, options, reads: r, playerNames: r ? nameRows(r.players, names) : [], unitLabels: r ? unitLabels(r.units, names) : [] }, season, current: 2026, basePath: BASE, teamName: 'Team' },
        locals: { league } as App.Locals,
    });
};
const body = (html: string, id: string) => html.split(`id="${id}"`)[1].split('<tbody>')[1].split('</tbody>')[0];
const rowsOf = (html: string, id: string) => body(html, id).match(/<tr/g)?.length ?? 0;
/** The text of every cell of one table's body, row by row. */
const cells = (html: string, id: string) => body(html, id).split('</tr>').slice(0, -1).map((tr) => [...tr.matchAll(/<t[hd][^>]*>(?:<span[^>]*>)?([^<]*)/g)].map((m) => m[1]));

describe('SituationsTab', () => {
    test("Minnesota in the clutch: the team's clutch row then All, its players and units, one number per cell, the producer's", async () => {
        const html = await render('nba', NBA, 2024, 'clutch');
        const team = cells(html, 'situations-team');
        const own = NBA.team.find((r) => r.split === 'clutch')!;
        expect(team).toEqual([
            ['Clutch', String(own.games), String(Math.round(own.minutes)), String(own.poss), String(own.opp_poss), String(own.pts), String(own.opp_pts), own.off_rtg.toFixed(1), own.def_rtg.toFixed(1), (own.net_rtg >= 0 ? '+' : '') + own.net_rtg.toFixed(1), String(own.plus_minus)],
            expect.arrayContaining(['All']),
        ]);
        expect(own.plus_minus).toBe(-32);
        const players = api(NBA, { family: 'clutch', split: 'clutch' }).players;
        expect(rowsOf(html, 'situations-players')).toBe(players.length);
        expect(cells(html, 'situations-players')[0]).toHaveLength(11);
        expect(html).toContain('Rudy Gobert');
        expect(html).toContain('Players with 10+ possessions in the situation, most first.');
        // 24 of Minnesota's gated fives played a clutch possession, 2 of them 25 or more: those are listed
        expect(NBA.lineups.filter((u) => u.split === 'clutch').length).toBe(24);
        expect(rowsOf(html, 'situations-units')).toBe(2);
        expect(html).toContain('2 units, most possessions first; units with 25+ possessions in the situation');
        // the minimums are the API's poss__gte: 9 players reach 10 clutch possessions
        expect(players.length).toBe(9);
        expect(NBA.players.filter((r) => r.split === 'clutch').length).toBeGreaterThan(9);
        expect(html).not.toMatch(/hulk-bg-level-\d/);
        for (const bad of ['undefined', 'NaN', '>#', 'n/a']) expect(html).not.toContain(bad);
    });
    test('the control is one select of URLs: the season kept, All dropped as the default, to the section; the periods grouped', async () => {
        const html = await render('nba', NBA, 2024, 'p3');
        const sel = html.split('id="situation"')[1].split('</select>')[0];
        const opts = [...sel.matchAll(/<option value="([^"]+)"( selected)?>([^<]*)/g)].map((m) => [m[1].replaceAll('&amp;', '&'), !!m[2], m[3]]);
        expect(opts[0]).toEqual([`${BASE}?season=2024#situations`, false, 'All']);
        expect(opts.find((o) => o[1])).toEqual([`${BASE}?season=2024&situation=p3#situations`, true, '3rd quarter']);
        expect(opts.map((o) => o[2])).toEqual(situationsFor('nba', 2024).map((s) => s.label));
        expect(sel.split('<optgroup label="By period">')[1].split('</optgroup>')[0].match(/<option/g)).toHaveLength(5);
        expect(html.match(/onchange="window.location.href = this.value"/g)).toHaveLength(1);
        expect(html).toContain('Possessions that start in the 3rd quarter.');
    });
    test("Minnesota on second chances: the producer's chance/second_chance team row then All, its players' rows", async () => {
        const html = await render('nba', NBA, 2024, 'second_chance');
        const own = NBA.team.find((r) => r.family === 'chance' && r.split === 'second_chance')!;
        const team = cells(html, 'situations-team');
        expect(team.map((t) => t[0])).toEqual(['Second chance', 'All']);
        expect(team[0].slice(3, 7)).toEqual([own.poss, own.opp_poss, own.pts, own.opp_pts].map((v) => v.toLocaleString('en-US')));
        expect(rowsOf(html, 'situations-players')).toBe(api(NBA, { family: 'chance', split: 'second_chance' }).players.length);
        expect(html).toContain('Possessions with an offensive rebound.');
        expect(html).toContain(`value="${BASE}?season=2024&amp;situation=second_chance#situations" selected`);
    });
    test('Michigan State vs the top 25: named from ncaa_player_box (text ids), the units capped', async () => {
        const html = await render('mbb', MBB, 2025, 'vs_top');
        const r = api(MBB, { family: 'opponent', split: 'vs_top' });
        expect(cells(html, 'situations-team').map((t) => t[0])).toEqual(['vs top 25', 'All']);
        expect(rowsOf(html, 'situations-players')).toBe(r.players.length);
        // more of the gated fives than the cap played the top 25, 7 of them 25 possessions or more
        expect(MBB.lineups.filter((u) => u.split === 'vs_top').length).toBeGreaterThan(UNIT_LIMIT);
        expect(rowsOf(html, 'situations-units')).toBe(r.units.length);
        expect(r.units.length).toBe(7);
        expect(html).not.toContain('>#');
        expect(html).toContain('Jaden Akins');
    });
    test('a situation with no possession (no overtime in the season) keeps All and says so per table', async () => {
        const noOt = { ...NBA, team: NBA.team.filter((r) => r.split !== 'ot'), players: NBA.players.filter((r) => r.split !== 'ot'), lineups: NBA.lineups.filter((r) => r.split !== 'ot') };
        const html = await render('nba', noOt, 2024, 'ot');
        expect(cells(html, 'situations-team').map((t) => t[0])).toEqual(['All']);
        expect(html).toContain('no possession in the situation (Overtime)');
        expect(html).toContain('id="situations-players-empty"');
        expect(html).toContain('id="situations-units-empty"');
    });
    test('before the backfill (empty tables) the section is the empty note, the control kept; a failed read says unavailable', async () => {
        const empty = await render('nba', NBA, 2024, 'clutch', { team: [], players: [], units: [], names: [] });
        expect(empty).toContain('id="situations-empty"');
        expect(empty).toContain('No 2023-24 possessions are split by situation for Team yet.');
        expect(empty).toContain('id="situation"');
        expect(empty).not.toContain('id="situations-team"');
        const down = await render('nba', NBA, 2024, 'clutch', null);
        expect(down).toContain('id="situations-unavailable"');
        expect(down).not.toContain('id="situations-team"');
    });
});

describe('the player page (Q28: the control there too)', () => {
    const playerAstro = (search: string, league: 'nba' | 'mbb' = 'nba') => {
        const cache: unknown[] = [];
        const headers = new Headers();
        return { astro: { params: {}, url: new URL(`https://gameonpaper.com/${league}/players/1${search}`), locals: { preview: true }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
    };
    const renderPlayer = (league: 'nba' | 'mbb', rows: any[] | null, key: string, season = 2026) => {
        const options = situationsFor(league, season);
        return container.renderToString(PlayerSituations, {
            props: { data: { situation: parseSituation(key, options), options, rows }, season, current: 2026, basePath: '/nba/players/1630162', playerName: 'Anthony Edwards', teamTricode: 'MIN' },
            locals: { league } as App.Locals,
        });
    };
    test("Edwards in transition: his row then All, the team table's 10 columns, the producer's numbers", async () => {
        const html = await renderPlayer('nba', PLAYER.nba.rows, 'transition');
        const own = PLAYER.nba.rows.find((r: any) => r.split === 'transition');
        expect(cells(html, 'situations-player')).toEqual([
            ['Transition', String(own.games), Math.round(own.minutes).toLocaleString('en-US'), own.poss.toLocaleString('en-US'), own.opp_poss.toLocaleString('en-US'), own.pts.toLocaleString('en-US'), own.opp_pts.toLocaleString('en-US'), own.off_rtg.toFixed(1), own.def_rtg.toFixed(1), (own.net_rtg >= 0 ? '+' : '') + own.net_rtg.toFixed(1), (own.plus_minus > 0 ? '+' : '') + own.plus_minus.toLocaleString('en-US')],
            expect.arrayContaining(['All']),
        ]);
        expect(html).toContain('Anthony Edwards with MIN, 2025-26.');
        const sel = html.split('id="situation"')[1].split('</select>')[0].replaceAll('&amp;', '&');
        expect(sel).toContain('value="/nba/players/1630162?situation=transition#situations" selected');
        expect(sel).toContain('value="/nba/players/1630162#situations"');
    });
    test("Boozer's overtime: under 10 possessions, so the API answered no row; All stays and the caption says so", async () => {
        expect(PLAYER.mbb.rows.some((r: any) => r.split === 'ot')).toBe(false);
        const html = await renderPlayer('mbb', PLAYER.mbb.rows, 'ot');
        expect(cells(html, 'situations-player').map((r) => r[0])).toEqual(['All']);
        expect(html).toContain('under 10 possessions in the situation (Overtime)');
    });
    test('no rows yet is the empty note; a failed read says unavailable; the control stays', async () => {
        const empty = await renderPlayer('nba', [], 'all');
        expect(empty).toContain('id="situations-empty"');
        expect(empty).toContain('id="situation"');
        const down = await renderPlayer('nba', null, 'clutch');
        expect(down).toContain('id="situations-unavailable"');
    });
});
