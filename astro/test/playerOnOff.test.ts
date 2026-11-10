// BB-G7: the player page's On/Off section behind 'bball-player-on-off'. The reads' queries (his id on both sides of the
// producer's pair order), the top partners and their orientation, the page-side step (the flag gates the reads, a failed
// read keeps the page and is never cached), the section and the page: flag off is byte for byte the NBA byte-identity
// capture. On sdv-db's committed player_on_off / player_wowy producer output for Minnesota 2024-25, #407's fixture
// (fixtures/README.md: on-off-nba-2025.json.gz), and for college on live Duke 2025-26 reads through ncaa_player_crosswalk
// (on-off-mbb-2026.json.gz). Every Data API read is mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { seasonPlayerRows } from './nba/rows';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// no network: an unmocked Data API read (vitest's dummy SDV_AUTH_TOKEN) fails auth and locks the IP out, so any fetch throws and is recorded
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const MIN = 1610612750;
// Minnesota 2024-25, its whole regular season. The capture was filtered by team_id, so its rows carry none; the API's do.
const CAP: { players: any[]; pairs: any[] } = gz('on-off-nba-2025');
const PLAYERS = CAP.players.map((r) => ({ team_id: MIN, ...r }));
const PAIRS = CAP.pairs.map((r) => ({ team_id: MIN, ...r }));
const NAMES: { person_id: number; player_name: string; team_id: number }[] = gz('lineups-nba-2025').names; // Minnesota's shot_season_players rows
const EDWARDS = 1630162; // Minnesota's most minutes on the floor; the smaller id in 8 of his 19 pairs, the larger in 11
// Duke 2025-26 (ESPN team 150): its crosswalk pairs, and its leading shooter's on/off row and WOWY pairs by his stats.ncaa.org id
const MBB: { xwalk: any[]; players: any[]; pairsA: any[]; pairsB: any[] } = gz('on-off-mbb-2026');
const DUKE = 150, DUKE_PID = 5041935, DUKE_NCAA = '11195975';

/** The Data API's own filters over the capture: season, player_id / player_id_a / player_id_b, order=-minutes_on, limit. */
function api(league: string, table: string, q: Record<string, string>) {
    const college = league === 'mbb';
    const rows = table === 'ncaa_player_crosswalk' ? (college ? MBB.xwalk : [])
        : table === 'player_on_off' ? (college ? MBB.players : PLAYERS)
        : table === 'player_wowy' ? (college ? [...MBB.pairsA, ...MBB.pairsB] : PAIRS) : [];
    // the crosswalk's espn_team_id is an integer: the API filters it by its digits
    const out = rows.filter((r: any) => ['player_id', 'player_id_a', 'player_id_b', 'espn_team_id'].every((k) => q[k] === undefined || String(r[k]) === q[k]));
    if (q.order === '-minutes_on') out.sort((a: any, b: any) => b.minutes_on - a.minutes_on);
    return Promise.resolve(out.slice(0, Number(q.limit)));
}
const sdv = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()), retrieveRows: (...a: unknown[]) => sdv.fn(...a) }));
// the player page's other reads, as playerImpact.test.ts mocks them
vi.mock('../src/resources/shotQuality', () => ({ retrieveGameShotQuality: async () => [], retrieveTeamShotQuality: async () => [], retrievePlayerShotQuality: async () => [] }));
vi.mock('../src/resources/playerImpact', () => ({ retrievePlayerImpact: async () => [] }));
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());
const oracle = fx('nba/league_context');
const shots = fx('nba/shots') as any[];
const byPlayer = fx('nba/player_games') as Record<string, any[]>;
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => seasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrievePlayerShots: async (_s: number, id: number) => shots.filter((s) => s.person_id === id).map(lite),
    retrievePlayerGameRows: async (_s: number, id: number) => (byPlayer[String(id)] ?? []).map((g) => ({
        season: 2026, person_id: id, game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
        fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
    })),
    retrievePlayerSeasons: async () => [2025, 2026],
    retrieveCoverageRows: async () => [],
}));

import PlayerOnOff from '../src/components/nba/PlayerOnOff.astro';
import { ON_OFF_SELECT, PAIR_LIMIT, retrievePlayerOnOff, ROSTER_LIMIT, TEAM_LIMIT, WOWY_SELECT } from '../src/resources/playerOnOff';
import { prepareBasketballPlayer } from '../src/routes/basketball/player';
import { FLAGS } from '../src/utils/features';
import { generateColorRampValue } from '../src/utils/misc';
import { espnPartners, TOP_PARTNERS, topPartners, type PlayerOnOff as Data } from '../src/utils/playerOnOff';

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, Michael Porter Jr., a Net in seasonPlayerRows() (the page tests' player)
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-player-on-off': false };
const locals = (on: boolean) => ({ preview: true, flagOverrides: { ...OFF, 'bball-player-on-off': on } });
const byId = new Map(PLAYERS.map((p) => [String(p.player_id), p]));
const teamMinutes = (p: any) => p.minutes_on + p.minutes_off;

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the page's season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => { sdv.fn.mockReset(); sdv.fn.mockImplementation(api); });

describe('the reads', () => {
    test("three strict reads in the pros' season schema, each by season and his id, with a small cap", async () => {
        const r = await retrievePlayerOnOff('nba', 2025, EDWARDS, MIN);
        const tail = [21600, true];
        expect(sdv.fn).toHaveBeenCalledWith('nba', 'player_on_off', { season: '2025', player_id: String(EDWARDS), order: '-minutes_on', select: ON_OFF_SELECT, limit: String(TEAM_LIMIT) }, ...tail);
        expect(sdv.fn).toHaveBeenCalledWith('nba', 'player_wowy', { season: '2025', player_id_a: String(EDWARDS), select: WOWY_SELECT, limit: String(PAIR_LIMIT) }, ...tail);
        expect(sdv.fn).toHaveBeenCalledWith('nba', 'player_wowy', { season: '2025', player_id_b: String(EDWARDS), select: WOWY_SELECT, limit: String(PAIR_LIMIT) }, ...tail);
        expect(sdv.fn).toHaveBeenCalledTimes(3);
        expect([r.playerId, r.toEspn]).toEqual([String(EDWARDS), null]);
        expect(r.teams).toEqual([byId.get(String(EDWARDS))]);
        // both sides of the producer's id order: all 19 of his teammates
        expect(r.pairs).toHaveLength(19);
        // select names exactly the capture's columns (plus team_id, which the API returns and the capture's team filter dropped)
        expect(ON_OFF_SELECT.split(',').sort()).toEqual(Object.keys(PLAYERS[0]).sort());
        expect(WOWY_SELECT.split(',').sort()).toEqual(Object.keys(PAIRS[0]).sort());
    });
});

describe('college (Duke 2025-26), through ncaa_player_crosswalk', () => {
    test("his team's crosswalk pairs first, then the three reads by his stats.ncaa.org id", async () => {
        const r = await retrievePlayerOnOff('mbb', 2026, DUKE_PID, DUKE);
        const tail = [21600, true];
        expect(sdv.fn.mock.calls[0]).toEqual(['mbb', 'ncaa_player_crosswalk', { season: '2026', espn_team_id: String(DUKE), select: 'ncaa_player_id,espn_athlete_id', limit: String(ROSTER_LIMIT) }, ...tail]);
        for (const side of ['player_id_a', 'player_id_b']) expect(sdv.fn).toHaveBeenCalledWith('mbb', 'player_wowy', { season: '2026', [side]: DUKE_NCAA, select: WOWY_SELECT, limit: String(PAIR_LIMIT) }, ...tail);
        expect(sdv.fn).toHaveBeenCalledWith('mbb', 'player_on_off', { season: '2026', player_id: DUKE_NCAA, order: '-minutes_on', select: ON_OFF_SELECT, limit: String(TEAM_LIMIT) }, ...tail);
        expect(sdv.fn).toHaveBeenCalledTimes(4);
        expect(r.playerId).toBe(DUKE_NCAA);
        // every id a string: the crosswalk's bigint espn_athlete_id and text ncaa_player_id meet in one type
        expect([...r.toEspn!].every(([k, v]) => typeof k === 'string' && typeof v === 'string')).toBe(true);
        expect(r.toEspn!.size).toBe(MBB.xwalk.length);
        expect(r.teams).toEqual(MBB.players);
        expect(r.pairs).toHaveLength(MBB.pairsA.length + MBB.pairsB.length);
    });
    test("top partners as ESPN athlete ids, oriented from his side (together + he without = his minutes on)", async () => {
        const r = await retrievePlayerOnOff('mbb', 2026, DUKE_PID, DUKE);
        const top = espnPartners(topPartners(r.pairs, r.playerId!), r.toEspn!);
        expect(top).toHaveLength(TOP_PARTNERS);
        const espnIds = new Set(MBB.xwalk.map((x) => String(x.espn_athlete_id)));
        expect(top.every((l) => espnIds.has(l.teammate) && l.teammate !== String(DUKE_PID))).toBe(true);
        for (const l of top) expect(l.together.minutes + l.without.minutes).toBeCloseTo(MBB.players[0].minutes_on, 0);
        // the most minutes with him: stats.ncaa.org 9335969, ESPN 5061585 in the crosswalk
        expect(top[0].teammate).toBe(String(MBB.xwalk.find((x) => x.ncaa_player_id === '9335969').espn_athlete_id));
        // a teammate with no pair never takes another player's name or link
        expect(espnPartners(topPartners(r.pairs, r.playerId!), new Map())[0].teammate).toBe('ncaa:9335969');
    });
    test('a player with no crosswalk pair: only the crosswalk read, no rows', async () => {
        const r = await retrievePlayerOnOff('mbb', 2026, 1, DUKE);
        expect(sdv.fn).toHaveBeenCalledTimes(1);
        expect(r).toMatchObject({ teams: [], pairs: [], playerId: null });
    });
    test('the section: his Duke row, the partners linked to their ESPN player pages, and no pro source note', async () => {
        const r = await retrievePlayerOnOff('mbb', 2026, DUKE_PID, DUKE);
        const partners = espnPartners(topPartners(r.pairs, r.playerId!), r.toEspn!);
        // the page's season rows supply the names; here each partner's own ESPN id stands in for one
        const names = new Map(partners.map((l) => [l.teammate, `Player ${l.teammate}`]));
        const html = await container.renderToString(PlayerOnOff, { props: { data: { teams: r.teams, partners, names, tricodes: new Map([[String(DUKE), 'DUKE']]) }, season: 2026, q: '', name: 'Duke guard' }, locals: { league: 'mbb' } as any });
        expect(html).toContain(`>${MBB.players[0].games} of ${MBB.players[0].team_games}</td>`);
        expect(html).toContain(`<a href="/mbb/players/${partners[0].teammate}">Player ${partners[0].teammate}</a>`);
        expect(html).toMatch(/>DUKE</);
        expect(html).not.toContain('counts the off side only while');
        expect(html).not.toMatch(/undefined|NaN|ncaa:/);
    });
});

describe('the captures', () => {
    test("on + off is the team's season for every player, and a pair's four parts are the team's minutes", () => {
        const team = teamMinutes(PLAYERS[0]);
        for (const p of PLAYERS) expect(teamMinutes(p)).toBeCloseTo(team, 3);
        for (const r of PAIRS) expect(r.minutes_both + r.minutes_a_only + r.minutes_b_only + r.minutes_neither).toBeCloseTo(team, 3);
    });
});

describe('topPartners', () => {
    test('his five teammates with the most minutes together, read from his side whichever id is smaller', async () => {
        const { pairs } = await retrievePlayerOnOff('nba', 2025, EDWARDS, MIN);
        const top = topPartners(pairs, String(EDWARDS));
        expect(top).toHaveLength(TOP_PARTNERS);
        const me = byId.get(String(EDWARDS))!;
        const together = top.map((l) => l.together.minutes);
        expect(together).toEqual([...together].sort((a, b) => b - a));
        // nobody left out has more minutes with him than the fifth
        const all = pairs.map((r: any) => r.minutes_both).sort((a: number, b: number) => b - a);
        expect(together).toEqual(all.slice(0, TOP_PARTNERS));
        // orientation, against the on/off rows: together + "he without" is his minutes on; together + "teammate without" is the teammate's
        for (const l of top) {
            expect(l.together.minutes + l.without.minutes).toBeCloseTo(me.minutes_on, 3);
            expect(l.together.minutes + l.mateOnly.minutes).toBeCloseTo(byId.get(l.teammate)!.minutes_on, 3);
        }
        // the five include pairs where he is player_id_a and where he is player_id_b
        expect(new Set(top.map((l) => Number(l.teammate) > EDWARDS))).toEqual(new Set([true, false]));
    });
    test('no pair, no partners', () => { expect(topPartners([], String(EDWARDS))).toEqual([]); });
});

describe('the player page step', () => {
    function fakeAstro(on: boolean, league = 'nba') {
        const cache: unknown[] = [];
        return { astro: { params: { id: String(PID) }, url: new URL(`https://gameonpaper.com/${league}/players/${PID}?season=2026`), locals: locals(on), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
    }
    const ok = <T extends object>(r: T | { notFound: true } | { unavailable: true }): T => { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; };
    const onOffReads = () => sdv.fn.mock.calls.filter((c) => c[1] === 'player_on_off' || c[1] === 'player_wowy');
    test("the flag is 'preview'", () => { expect(FLAGS['bball-player-on-off']).toBe('preview'); });
    test('off: no read and no onOff key', async () => {
        const r = ok(await prepareBasketballPlayer(fakeAstro(false).astro, 'nba'));
        expect(onOffReads()).toEqual([]);
        expect('onOff' in r).toBe(false);
    });
    test('on: the three reads by his person id; the names and tricodes are the season rows; cached as before', async () => {
        const a = fakeAstro(true);
        const r = ok(await prepareBasketballPlayer(a.astro, 'nba'));
        expect(onOffReads().map((c) => c[2].player_id ?? c[2].player_id_a ?? c[2].player_id_b)).toEqual([String(PID), String(PID), String(PID)]);
        expect(r.onOff).toMatchObject({ teams: [], partners: [] });
        expect(r.onOff!.names.get(String(PID))).toBe('Michael Porter Jr.');
        expect(r.onOff!.tricodes.get(String(r.player.team_id))).toBe(r.player.team_tricode);
        expect(a.cache.at(-1)).not.toBe(false);
    });
    test('a failed read: teams null, the page still renders and is never cached', async () => {
        sdv.fn.mockImplementation((l: string, t: string, q: Record<string, string>) => (t === 'player_wowy' ? Promise.reject(new Error('down')) : api(l, t, q)));
        const a = fakeAstro(true);
        expect(ok(await prepareBasketballPlayer(a.astro, 'nba')).onOff).toMatchObject({ teams: null, partners: [] });
        expect(a.cache.at(-1)).toBe(false);
    });
    test("college: the crosswalk read by his team first; a player it has no pair for reads nothing more and shows an empty section", async () => {
        const r = ok(await prepareBasketballPlayer(fakeAstro(true, 'mbb').astro, 'mbb'));
        const xw = sdv.fn.mock.calls.filter((c) => c[1] === 'ncaa_player_crosswalk');
        expect(xw.map((c) => c[2].espn_team_id)).toEqual([String(r.player.team_id)]);
        expect(onOffReads()).toEqual([]);
        expect(r.onOff).toMatchObject({ teams: [], partners: [] });
    });
});

describe('the section', () => {
    async function data(): Promise<Data> {
        const { teams, pairs } = await retrievePlayerOnOff('nba', 2025, EDWARDS, MIN);
        return {
            teams, partners: topPartners(pairs, String(EDWARDS)),
            names: new Map(NAMES.map((n) => [String(n.person_id), n.player_name])), tricodes: new Map([[String(MIN), 'MIN']]),
        };
    }
    const render = (d: Data, league = 'nba', season = 2025) => container.renderToString(PlayerOnOff, { props: { data: d, season, q: '?season=2025', name: 'Anthony Edwards' }, locals: { league } as any });
    test("his team's row: GP of the team's, the producer's ratings, shaded by the producer's percentile on and on − off only", async () => {
        const d = await data();
        const html = await render(d);
        const me = byId.get(String(EDWARDS))!;
        expect(html).toContain('<a href="/nba/team/1610612750?season=2025">MIN</a>');
        expect(html).toContain(`>${me.games} of ${me.team_games}</td>`);
        expect(html).toContain(`>${me.off_rtg_on.toFixed(1)}</td>`);
        const row = html.match(/<tbody>[\s\S]*?<\/tbody>/)![0];
        const shaded = [...row.matchAll(/hulk-bg-level-\d+/g)].map((m) => m[0]);
        const want = (['on', 'diff'] as const).flatMap((s) => (['off_rtg', 'def_rtg', 'net_rtg'] as const).map((m) => generateColorRampValue(me[`${m}_${s}_pct`], 100))).filter(Boolean);
        expect(shaded.sort()).toEqual((want as string[]).sort());
        expect(html).toContain('stats.nba.com counts the off side only while the player was on the roster');
        expect(html).toContain("So on plus off is always the team's whole season.");
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test('top partners: five rows, named and linked from the season rows; an id with no name reads as #<id>', async () => {
        const d = await data();
        const html = await render(d);
        const table = html.match(/<table[^>]*id="wowy-table"[\s\S]*?<\/table>/)![0];
        expect(table.match(/<tr>/g)).toHaveLength(2 + TOP_PARTNERS);
        const first = d.partners[0];
        expect(table).toContain(`<a href="/nba/players/${first.teammate}?season=2025">${d.names.get(first.teammate)}</a>`);
        expect(table).toContain('Anthony Edwards without');
        const html2 = await render({ ...d, names: new Map() });
        expect(html2).toContain(`>#${first.teammate}</th>`);
    });
    test('WNBA names its own reference', async () => {
        expect(await render(await data(), 'wnba')).toContain('stats.wnba.com counts the off side');
    });
    test('empty tables (before the backfill), no pairs, a failed read: each says so', async () => {
        const none = { teams: [], partners: [], names: new Map(), tricodes: new Map() };
        const empty = await render(none);
        expect(empty).toContain('id="on-off-empty"');
        expect(empty).not.toContain('<table');
        expect(await render({ ...(await data()), partners: [] })).toContain('id="wowy-empty"');
        expect(await render({ ...none, teams: null })).toContain('id="on-off-unavailable"');
    });
});

describe('the page', () => {
    const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
    const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
    async function page(on: boolean) {
        const { default: Page } = await import('../src/pages/nba/players/[id].astro');
        return normalize(await container.renderToString(Page, { params: { id: String(PID) }, request: new Request(`https://gameonpaper.com/nba/players/${PID}?season=2026`), locals: locals(on) as unknown as App.Locals }));
    }
    test("off: byte for byte the NBA byte-identity capture (main's page)", async () => {
        // a Windows checkout may write the capture with CRLF; the render is LF
        const snap = readFileSync(new URL('./nba/__byte_identity__/player.html', import.meta.url)).toString().replace(/\r\n/g, '\n');
        expect(await page(false)).toBe(snap);
        expect(sdv.fn.mock.calls.filter((c) => c[1] === 'player_on_off' || c[1] === 'player_wowy')).toEqual([]);
    });
    test('on (empty tables, as before the backfill): the section and its link in "On this page", and nothing else changes', async () => {
        const [off, on] = [await page(false), await page(true)];
        expect(on).toContain('<a href="#on-off" class="ms-2">On/Off</a>');
        const section = on.match(/<section id="on-off"[\s\S]*?<\/section>/)![0];
        expect(section).toContain('id="on-off-empty"');
        expect(on.replace(section, '').replace('<a href="#on-off" class="ms-2">On/Off</a>', '')).toBe(off.replace(/(<\/nav>)(\s*)/, '$1$2'));
    });
});
