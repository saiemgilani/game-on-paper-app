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
// Philadelphia 2024-25, the live player_on_off read with the producer's span columns (Quentin Grimes joined in February)
const PHI: Capture = { ...gz('on-off-phi-2025'), pairs: [] };
const GRIMES = 1629656;
const BIO: any[] = gz('player-bio-nba-2025'); // the NBA's 2024-25 regular-season player_bio names (Jesse Edwards, 1642399, among them)

const sdv = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()), retrieveRows: (...a: unknown[]) => sdv.fn(...a) }));
const reads = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/onOff', async (orig) => ({ ...(await orig<typeof import('../src/resources/onOff')>()), retrieveOnOff: (...a: unknown[]) => reads.fn(...a) }));
vi.mock('../src/resources/lineups', async (orig) => ({ ...(await orig<typeof import('../src/resources/lineups')>()), retrieveLineups: async () => ({ units: [], names: [], pairs: [] }) }));
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
import { BIO_LIMIT, PAIR_LIMIT, PLAYER_LIMIT, RATINGS } from '../src/resources/onOff';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { FLAGS } from '../src/utils/features';
import { playerNames } from '../src/utils/lineups';
import { generateColorRampValue } from '../src/utils/misc';
import { isShortTenure, ON_OFF_MIN_MINUTES, parseWowy, shownLines, shownPlayers, sideValue, usesSpan, WOWY_MIN_MINUTES, wowyLines, type OnOffTab as Tab } from '../src/utils/onOff';
import { fmtInt as fmtIntT } from '../src/nba/format';

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
        // every column the section reads is selected, nothing else (the live capture was projected to it)
        expect(q.player_on_off.select.split(',').sort()).toEqual(Object.keys(PHI.players[0]).sort());
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
    test('a pro with no season row is named by one player_bio read (only then); ?onoff=all is read', async () => {
        const rows = apiSeasonPlayerRows().filter((p: any) => p.team_id === NETS_TEAM_ID);
        const players = [{ ...NBA.players[0], player_id: rows[0].person_id }, NBA.players.find((p) => p.player_id === 1642399)];
        reads.fn.mockResolvedValue({ players, pairs: [], names: [] });
        sdv.fn.mockImplementation(async (_l: string, table: string) => (table === 'player_bio' ? BIO : []));
        const r = ok(await prepareNbaTeam(fakeAstro({ preview: true }, '?season=2026&onoff=all').astro));
        expect(sdv.fn.mock.calls.filter((c) => c[1] === 'player_bio')).toHaveLength(1);
        const bio = sdv.fn.mock.calls.find((c) => c[1] === 'player_bio')!;
        expect([bio[0], bio[2], bio[4]]).toEqual(['nba', { season: '2026', season_type: 'Regular Season', select: 'player_id,player_name', limit: String(BIO_LIMIT) }, true]);
        expect(r.onOff!.names.get('1642399')).toBe('Jesse Edwards');
        expect(r.onOff!.names.get(String(rows[0].person_id))).toBe(rows[0].player_name);
        expect(r.onOff!.all).toBe(true);
        // every id named by the season rows: no bio read
        sdv.fn.mockClear();
        reads.fn.mockResolvedValue({ players: players.slice(0, 1), pairs: [], names: [] });
        const named = ok(await prepareNbaTeam(fakeAstro({ preview: true }).astro));
        expect(sdv.fn.mock.calls.some((c) => c[1] === 'player_bio')).toBe(false);
        expect(named.onOff!.all).toBe(false);
    });
    test('a failed name read keeps the section, with the #<id> stand-in', async () => {
        reads.fn.mockResolvedValue({ players: [NBA.players.find((p) => p.player_id === 1642399)], pairs: [], names: [] });
        sdv.fn.mockImplementation(async (_l: string, table: string) => { if (table === 'player_bio') throw new Error('503'); return []; });
        const r = ok(await prepareNbaTeam(fakeAstro({ preview: true }).astro));
        expect(r.onOff!.players).toHaveLength(1);
        expect(r.onOff!.names.has('1642399')).toBe(false);
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
const tabOf = (c: Capture, names: Map<string, string>, wowy: string | null = null, all = false): Tab => {
    const w = parseWowy(wowy, c.players);
    return { players: c.players, names, wowy: w, lines: wowyLines(c.pairs, w), all };
};
const render = (league: 'nba' | 'mbb', data: Tab) =>
    container.renderToString(OnOffTab, { props: { data, season: 2025, current: 2026, basePath: BASE, teamName: 'Team' }, locals: { league } as App.Locals });
const rowsOf = (html: string, id: string) => html.split(`id="${id}"`)[1].split('<tbody>')[1].split('</tbody>')[0].match(/<tr/g)?.length ?? 0;
const NBA_TAB = (all = false) => tabOf(NBA, playerNames(NBA_NAMES, []), null, all);

describe('OnOffTab', () => {
    test("Minnesota: one row per player, the producer's ratings, shaded only where ranked, the whole-season note", async () => {
        const html = await render('nba', NBA_TAB(true));
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
    test('the minutes minimum: players under 100 minutes on and teammates under 50 together are hidden, with a show-all link', async () => {
        const html = await render('nba', NBA_TAB());
        const shown = NBA.players.filter((p) => p.minutes_on >= ON_OFF_MIN_MINUTES);
        expect([shown.length, NBA.players.length]).toEqual([14, 20]);
        expect(rowsOf(html, 'on-off-table')).toBe(14);
        expect(html.split('id="on-off-table"')[1].split('</table>')[0]).not.toContain('#1642399'); // 3 minutes (the WOWY select still lists him)
        expect(html).toContain('(6 hidden)');
        expect(html.replaceAll('&amp;', '&')).toContain(`<a href="${BASE}?season=2025&onoff=all#on-off">Show all</a>`);
        const mates = shownLines(wowyLines(NBA.pairs, EDWARDS), false);
        expect(mates.every((l) => l.together.minutes >= WOWY_MIN_MINUTES)).toBe(true);
        expect(rowsOf(html.split('id="wowy"')[1], 'wowy-table')).toBe(mates.length);
        expect(html).toContain(`${19 - mates.length} teammates under 50 minutes together are hidden.`);
        // ?onoff=all: every row, a link back, and the WOWY select keeps it
        const all = await render('nba', NBA_TAB(true));
        expect(all.replaceAll('&amp;', '&')).toContain(`<a href="${BASE}?season=2025#on-off">Hide players under 100 minutes`);
        expect(all.replaceAll('&amp;', '&')).toContain(`value="${BASE}?season=2025&wowy=${NBA.players[1].player_id}&onoff=all#wowy"`);
        expect(shownPlayers(NBA.players, true)).toBe(NBA.players);
    });
    test('a player well short of the team\'s games (under three quarters) is flagged; the note says what the mark means', async () => {
        const html = await render('nba', NBA_TAB());
        const short = NBA.players.filter((p) => p.minutes_on >= ON_OFF_MIN_MINUTES && isShortTenure(p));
        expect(short.map((p) => p.games)).toEqual([39, 46, 31, 43, 38, 17]);
        expect(isShortTenure({ games: 62, team_games: 82 })).toBe(false);
        expect(isShortTenure({ games: 61, team_games: 82 })).toBe(true);
        expect(html.match(/>†</g)).toHaveLength(short.length);
        expect(html).toMatch(/title="Played 39 of the team('|&#39;)s 82 games, so his off side includes games he was not with the team or did not play"/);
        expect(html).toContain('† marks a player who played under three quarters');
    });
    test("a † player's off side and on − off are the producer's span columns (his time with the team); everyone else's the full season", async () => {
        const grimes = PHI.players.find((p) => p.player_id === GRIMES)!;
        expect([grimes.games, grimes.team_games, grimes.team_games_span, grimes.span_first_date, grimes.span_last_date]).toEqual([28, 82, 34, '2025-02-04', '2025-04-13']);
        expect(Math.round(grimes.minutes_off_span)).toBe(694);
        expect(Math.round(grimes.minutes_off)).toBe(3018);
        expect(usesSpan(grimes)).toBe(true);
        expect(sideValue(grimes, 'net_rtg', 'off')).toBe(grimes.net_rtg_off_span);
        expect(sideValue(grimes, 'net_rtg', 'diff')).toBe(grimes.net_rtg_diff_span);
        expect(sideValue(grimes, 'net_rtg', 'on')).toBe(grimes.net_rtg_on);
        // a full-season player keeps the full-season columns; a † row without span columns (an older capture) falls back
        const maxey = PHI.players.find((p) => !isShortTenure(p))!; // Tyrese Maxey
        expect(sideValue(maxey, 'off_rtg', 'off')).toBe(maxey.off_rtg_off);
        expect(NBA.players.some((p) => isShortTenure(p) && !usesSpan(p))).toBe(true);
        const html = await render('nba', tabOf(PHI, new Map(BIO.map((b) => [String(b.player_id), b.player_name]))));
        const row = html.split('id="on-off-table"')[1].split('<tr>').find((r) => r.includes('Quentin Grimes'))!;
        const cells = [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
        expect(cells.slice(0, 3)).toEqual(['28', '943', '694']);
        expect(cells.slice(6, 9)).toEqual([grimes.off_rtg_off_span.toFixed(1), grimes.def_rtg_off_span.toFixed(1), '-5.3']);
        expect(cells[11]).toBe('-8.3'); // the span on − off, not the full season's -9.3
        // the span on − off is unranked, so never shaded
        expect(row.split('<td').slice(-3).join('')).not.toMatch(/hulk-bg-level/);
        expect(row).toMatch(/title="Played 28 of the team('|&#39;)s 82 games\. His off side and on − off cover only his time with the team: its 34 games from Feb 4 to Apr 13"/);
        expect(html).toContain('his off side and on − off cover only his time with the team, the team');
        expect(html).toContain("So on plus off is the team's whole season for a player without †.");
        // Tyrese Maxey: full season, his own numbers
        const mrow = html.split('id="on-off-table"')[1].split('<tr>').find((r) => r.includes(BIO.find((b) => b.player_id === maxey.player_id).player_name))!;
        expect(mrow).toContain(`>${fmtIntT(maxey.minutes_off)}<`);
        for (const bad of ['undefined', 'NaN', 'Invalid']) expect(html).not.toContain(bad);
    });
    test("WOWY: Edwards by default, against his 19 teammates, unshaded; the select's URLs keep the season and drop the default", async () => {
        const html = await render('nba', NBA_TAB(true));
        const wowy = html.split('id="wowy"')[1];
        expect(rowsOf(wowy, 'wowy-table')).toBe(19);
        expect(wowy).toContain('Anthony Edwards without');
        expect(wowy).not.toMatch(/hulk-bg-level-\d/);
        const opts = [...wowy.split('id="wowy-player"')[1].split('</select>')[0].matchAll(/<option value="([^"]+)"( selected)?/g)].map((m) => [m[1].replaceAll('&amp;', '&'), !!m[2]]);
        expect(opts).toHaveLength(20);
        expect(opts[0]).toEqual([`${BASE}?season=2025&onoff=all#wowy`, true]);
        expect(opts[1]).toEqual([`${BASE}?season=2025&wowy=${NBA.players[1].player_id}&onoff=all#wowy`, false]);
        // the top line is the teammate he shared the most minutes with, read from his side
        const top = wowyLines(NBA.pairs, EDWARDS)[0];
        expect(wowy.split('<tbody>')[1]).toMatch(new RegExp(`^\\s*<tr[^>]*>\\s*<th[^>]*>${NBA_NAMES.find((n) => String(n.person_id) === top.teammate).player_name}</th>\\s*<td[^>]*>${Math.round(top.together.minutes).toLocaleString('en-US')}</td>`));
    });
    test("Xavier: named from ncaa_player_box, nothing shaded, and no stats.nba.com sentence", async () => {
        // two games: nobody reaches 100 minutes, so the default view says so and links to every row
        const few = await render('mbb', tabOf(MBB, playerNames([], MBB_NAMES)));
        expect(few).toContain('id="on-off-few"');
        expect(few).toContain('No Team player has 100 minutes on the floor in 2024-25 yet.');
        const html = await render('mbb', tabOf(MBB, playerNames([], MBB_NAMES), null, true));
        expect(rowsOf(html, 'on-off-table')).toBe(14);
        expect(rowsOf(html.split('id="wowy"')[1], 'wowy-table')).toBe(13);
        expect(html).not.toMatch(/hulk-bg-level-\d/);
        expect(html).not.toContain('>#');
        expect(html).toContain('all 2 of its games');
        expect(html).not.toContain('stats.');
    });
    test('the table before the backfill (no rows) is the empty note; a failed read says unavailable', async () => {
        const empty = await render('nba', { players: [], names: new Map(), wowy: null, lines: [], all: false });
        expect(empty).toContain('id="on-off-empty"');
        expect(empty).toContain('No Team on/off numbers for 2024-25 yet.');
        expect(empty).not.toContain('id="wowy"');
        const down = await render('nba', { players: null, names: new Map(), wowy: null, lines: [], all: false });
        expect(down).toContain('id="on-off-unavailable"');
        expect(down).not.toContain('id="on-off-table"');
    });
});
