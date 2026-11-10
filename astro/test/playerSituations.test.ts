// BB-G55: the player page's Situations section behind 'bball-player-situations'. The captures (the producer's splits add
// up to All within a family), the pure steps (the league's options, the whitelisted ?situation=, the rows per team), the
// read (situational_player in the league's season schema by person id; college by his season's stats.ncaa.org id from
// ncaa_player_crosswalk), the page-side step (the flag gates the read; a failed read keeps the page and is never cached),
// the section and the page: flag off is byte for byte the NBA byte-identity capture. On real producer output
// (fixtures/README.md: player-situations.json.gz). Every read is mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { seasonPlayerRows } from './nba/rows';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Every read is mocked: a live request from a test sends vitest.config's 'Bearer test' and counts as a failed auth
// against the Data API from this IP (429 lockout). A fetch here fails the file instead.
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

type Row = any; // fixture rows: the producer frames, checked by the tests below
const PS = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/player-situations.json.gz', import.meta.url))).toString()) as Record<'nba' | 'wnba' | 'mbb' | 'wbb' | 'mbbXwalk' | 'wbbXwalk', Row[]>;
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const reads = vi.hoisted(() => ({ situational: vi.fn() }));
vi.mock('../src/resources/situational', async (orig) => ({
    ...(await orig<typeof import('../src/resources/situational')>()),
    retrievePlayerSituational: (...a: unknown[]) => reads.situational(...a),
}));
const sdv = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
// the player page's other reads, exactly as playerWar.test.ts mocks them (their flags are off below)
vi.mock('../src/resources/shotQuality', () => ({ retrieveGameShotQuality: async () => [], retrieveTeamShotQuality: async () => [], retrievePlayerShotQuality: async () => [] }));
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
}));

import PlayerSituations from '../src/components/nba/PlayerSituations.astro';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { leagueSource, type BasketballLeague } from '../src/utils/league';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { FLAGS } from '../src/utils/features';
import { playerCache } from '../src/routes/basketball/cache';
import { parseSituation, playerSituationRows, situationRows, situationsFor, type PlayerSituations as Data } from '../src/utils/situations';

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, Michael Porter Jr., a Net in seasonPlayerRows()
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-war': false, 'bball-player-situations': false };
const locals = (on: boolean) => ({ preview: true, flagOverrides: { ...OFF, 'bball-player-situations': on } });
const LEAGUES: BasketballLeague[] = ['nba', 'wnba', 'mbb', 'wbb'];
const COLS = 'team_id,family,split,games,minutes,poss,opp_poss,pts,opp_pts,plus_minus,off_rtg,def_rtg,net_rtg';
const LIMIT = '125';
const find = (rows: Row[], family: string, split: string) => rows.find((r) => r.family === family && r.split === split);

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the page's season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    reads.situational.mockReset();
    sdv.from.mockReset();
    reads.situational.mockResolvedValue(PS.nba);
});
function fakeAstro(on: boolean, query = '?season=2026') {
    const cache: unknown[] = [];
    return { astro: { params: { id: String(PID) }, url: new URL(`https://gameonpaper.com/nba/players/${PID}${query}`), locals: locals(on), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }

describe('the captures', () => {
    test("one team each; within every family the splits' possessions and points add up to All (the producer's contract)", () => {
        for (const l of LEAGUES) {
            const rows = PS[l];
            expect(new Set(rows.map((r) => r.team_id)).size).toBe(1);
            const all = find(rows, 'all', 'all');
            for (const family of new Set(rows.map((r) => r.family))) {
                const parts = rows.filter((r) => r.family === family);
                for (const k of ['poss', 'opp_poss', 'pts', 'opp_pts']) expect(parts.reduce((a, r) => a + r[k], 0)).toBe(all[k]);
            }
        }
    });
    test("college has no second-chance rows (no offensive-rebound flag); the pros do", () => {
        expect([find(PS.nba, 'chance', 'second_chance'), find(PS.wnba, 'chance', 'second_chance')].every(Boolean)).toBe(true);
        expect(PS.mbb.some((r) => r.family === 'chance') || PS.wbb.some((r) => r.family === 'chance')).toBe(false);
    });
});

describe('situationsFor', () => {
    test("All, Clutch, the season's periods, overtime, Leading, Trailing, Garbage time out, vs top N, Transition; Second chance for the pros", () => {
        expect(situationsFor('nba', 2026).map((s) => s.key)).toEqual(['all', 'clutch', 'p1', 'p2', 'p3', 'p4', 'ot', 'leading', 'trailing', 'not_garbage_time', 'vs_top', 'transition', 'second_chance']);
        expect(situationsFor('mbb', 2026).map((s) => s.key)).toEqual(['all', 'clutch', 'p1', 'p2', 'ot', 'leading', 'trailing', 'not_garbage_time', 'vs_top', 'transition']);
        expect(situationsFor('wbb', 2026).filter((s) => s.group).map((s) => s.label)).toEqual(['1st quarter', '2nd quarter', '3rd quarter', '4th quarter', 'Overtime']);
        expect(situationsFor('wnba', 2026).find((s) => s.key === 'vs_top')!.label).toBe('vs top 4');
    });
    test("every option is a producer split in the league's capture (Boozer had no overtime possession)", () => {
        for (const l of LEAGUES) {
            const missing = situationsFor(l, 2026).filter((s) => !find(PS[l], s.family, s.split)).map((s) => s.key);
            expect(missing).toEqual(l === 'mbb' ? ['ot'] : []);
        }
    });
    test('?situation= is whitelisted: anything else is All', () => {
        const o = situationsFor('nba', 2026);
        expect(parseSituation('clutch', o).key).toBe('clutch');
        for (const v of [null, '', 'CLUTCH', 'p5', 'second_chance;drop']) expect(parseSituation(v, o).key).toBe('all');
        expect(parseSituation('second_chance', situationsFor('mbb', 2026)).key).toBe('all');
    });
});

describe('the rows', () => {
    const o = situationsFor('nba', 2026);
    const s = (k: string) => parseSituation(k, o);
    test("the situation's row, then All; All alone; a situation he never played in is All alone", () => {
        expect(situationRows(PS.nba, s('clutch'))).toEqual([find(PS.nba, 'clutch', 'clutch'), find(PS.nba, 'all', 'all')]);
        expect(situationRows(PS.nba, s('all'))).toEqual([find(PS.nba, 'all', 'all')]);
        expect(situationRows(PS.mbb, parseSituation('ot', situationsFor('mbb', 2026)))).toEqual([find(PS.mbb, 'all', 'all')]);
        expect(situationRows(PS.nba.filter((r) => r.family !== 'all'), s('clutch'))).toEqual([]);
    });
    test('a traded player: one block per team, most possessions first', () => {
        // the second team's rows are his own, re-keyed and halved: only the grouping and the order are under test
        const other = PS.nba.map((r) => ({ ...r, team_id: 1, poss: Math.floor(r.poss / 2) }));
        const t = playerSituationRows([...other, ...PS.nba], s('clutch'));
        expect(t.map((x) => x.teamId)).toEqual([PS.nba[0].team_id, 1]);
        expect(t.map((x) => x.rows.length)).toEqual([2, 2]);
        expect(playerSituationRows([], s('clutch'))).toEqual([]);
    });
});

describe('the read', () => {
    const actual = () => vi.importActual<typeof import('../src/resources/situational')>('../src/resources/situational');
    test("the pros: situational_player in the season schema by his person id, every split, bounded", async () => {
        const { retrievePlayerSituational } = await actual();
        sdv.from.mockResolvedValue(PS.nba);
        expect(await retrievePlayerSituational('nba', 2026, 1628983)).toEqual(PS.nba);
        expect(sdv.from).toHaveBeenCalledTimes(1);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'situational_player', { season: '2026', player_id: '1628983', select: COLS, limit: LIMIT }, 21600, true, NBA_READ_TIMEOUT_MS);
        expect([leagueSource('nba').schema, leagueSource('wnba').schema]).toEqual(['nba_stats', 'wnba_stats']);
    });
    test("college: his season's stats.ncaa.org id from the crosswalk, then his rows by it", async () => {
        const { retrievePlayerSituational } = await actual();
        for (const [l, espn, xwalk] of [['mbb', 5041935, PS.mbbXwalk], ['wbb', 5239100, PS.wbbXwalk]] as const) {
            sdv.from.mockReset();
            sdv.from.mockResolvedValueOnce(xwalk).mockResolvedValueOnce(PS[l]);
            expect(await retrievePlayerSituational(l, 2026, espn)).toEqual(PS[l]);
            expect(sdv.from.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
                [leagueSource(l), 'ncaa_player_crosswalk', { season: '2026', espn_athlete_id: String(espn), select: 'ncaa_player_id', limit: '5' }],
                [leagueSource(l), 'situational_player', { season: '2026', player_id: xwalk[0].ncaa_player_id, select: COLS, limit: LIMIT }],
            ]);
        }
    });
    test('college: no matched pair is no rows and no second read; a failed crosswalk read rejects', async () => {
        const { retrievePlayerSituational } = await actual();
        sdv.from.mockResolvedValueOnce([]);
        expect(await retrievePlayerSituational('mbb', 2026, 1)).toEqual([]);
        expect(sdv.from).toHaveBeenCalledTimes(1);
        sdv.from.mockRejectedValueOnce(new Error('503 ncaa_player_crosswalk'));
        await expect(retrievePlayerSituational('wbb', 2026, 1)).rejects.toThrow('503');
    });
});

describe('the player page', () => {
    test("the flag is 'preview'", () => { expect(FLAGS['bball-player-situations']).toBe('preview'); });
    test('off: no read and no situations key', async () => {
        const r = ok(await prepareNbaPlayer(fakeAstro(false).astro));
        expect(reads.situational).not.toHaveBeenCalled();
        expect('situations' in r).toBe(false);
    });
    test('on: one read keyed by his person id, ?situation= picked; a failed read is null and never cached', async () => {
        const a = fakeAstro(true, '?season=2026&situation=clutch');
        const r = ok(await prepareNbaPlayer(a.astro));
        expect(reads.situational).toHaveBeenCalledTimes(1);
        expect(reads.situational).toHaveBeenCalledWith('nba', 2026, PID);
        expect(r.situations!.situation.key).toBe('clutch');
        expect(r.situations!.rows).toEqual(PS.nba);
        expect(a.cache).toEqual([playerCache('nba')]);
        reads.situational.mockRejectedValueOnce(new Error('404 situational_player'));
        const b = fakeAstro(true, '?season=2026&situation=bogus');
        const rb = ok(await prepareNbaPlayer(b.astro));
        expect(rb.situations!.rows).toBeNull();
        expect(rb.situations!.situation.key).toBe('all');
        expect(b.cache.at(-1)).toBe(false);
    });
});

describe('the section', () => {
    const data = (l: BasketballLeague, rows: Row[] | null, key: string, tricodes = new Map<string, string>()): Data => {
        const options = situationsFor(l, 2026);
        return { situation: parseSituation(key, options), options, rows, tricodes };
    };
    const render = (l: BasketballLeague, d: Data) => container.renderToString(PlayerSituations, { props: { data: d, season: 2026, current: 2027, basePath: `/${l}/players/9`, name: 'Him' }, locals: { league: l } as any });
    test("NBA clutch: the select of URLs, the situation's row and All, the producer's numbers", async () => {
        const html = await render('nba', data('nba', PS.nba, 'clutch'));
        const c = find(PS.nba, 'clutch', 'clutch');
        expect(html).toContain('<option value="/nba/players/9?season=2026&amp;situation=clutch#situations" selected>Clutch</option>');
        expect(html).toContain('<option value="/nba/players/9?season=2026#situations">All</option>');
        expect(html).toContain('>Second chance</option>');
        expect(html).toMatch(new RegExp(`>Clutch</th><td class="numeral text-end">${c.games}</td>[\\s\\S]*?>${c.poss}</td><td class="numeral text-end">${c.off_rtg.toFixed(1)}</td>`));
        expect(html).toContain('>+85</td>'); // his clutch +/- (2025-26)
        expect(html).not.toMatch(/<th scope="col">Team<\/th>|undefined|NaN/);
    });
    test('college: no Second chance; a situation he never played in says so; WBB quarters', async () => {
        const html = await render('mbb', data('mbb', PS.mbb, 'ot'));
        expect(html).not.toContain('Second chance');
        expect(html).toContain(': no possession in the situation (Overtime).');
        expect(await render('wbb', data('wbb', PS.wbb, 'p4'))).toMatch(/>4th quarter<\/th><td class="numeral text-end">\d+<\/td>/);
    });
    test('a traded player gets a Team column; a failed read and no rows each say so', async () => {
        const other = PS.wnba.map((r) => ({ ...r, team_id: 1 }));
        const html = await render('wnba', data('wnba', [...PS.wnba, ...other], 'transition', new Map([[String(PS.wnba[0].team_id), 'LVA']])));
        expect(html).toContain('<th scope="col">Team</th>');
        expect(html).toContain('>LVA</td>');
        expect(html).toContain('>#1</td>');
        expect(await render('nba', data('nba', null, 'all'))).toContain('id="situations-unavailable"');
        expect(await render('mbb', data('mbb', [], 'all'))).toContain('id="situations-empty"');
    });
});

describe('the page', () => {
    const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
    const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
    async function page(on: boolean, query = '?season=2026') {
        const { default: Page } = await import('../src/pages/nba/players/[id].astro');
        return normalize(await container.renderToString(Page, { params: { id: String(PID) }, request: new Request(`https://gameonpaper.com/nba/players/${PID}${query}`), locals: locals(on) as unknown as App.Locals }));
    }
    test("off: byte for byte the NBA byte-identity capture (main's page)", async () => {
        // a Windows checkout may write the capture with CRLF; the render is LF
        const snap = readFileSync(new URL('./nba/__byte_identity__/player.html', import.meta.url)).toString().replace(/\r\n/g, '\n');
        expect(await page(false)).toBe(snap);
        expect(reads.situational).not.toHaveBeenCalled();
    });
    test('on: the section and its link in "On this page", and nothing else changes', async () => {
        const [off, on] = [await page(false), await page(true)];
        const link = '<a href="#situations" class="ms-2">Situations</a>';
        expect(on).toContain(link);
        const section = on.match(/<section id="situations"[\s\S]*?<\/section>/)![0];
        expect(section).toContain('id="situations-player"');
        expect(on.replace(section, '').replace(link, '')).toBe(off.replace(/(<\/nav>)(\s*)/, '$1$2'));
    });
    test('the season select keeps the situation; All adds nothing to its links', async () => {
        const season = (html: string) => html.match(/<select id="nba-season"[\s\S]*?<\/select>/)![0];
        expect(season(await page(true, '?season=2026&situation=clutch'))).toContain(`/nba/players/${PID}?situation=clutch&amp;season=2025"`);
        expect(season(await page(true))).not.toContain('situation=');
    });
});
