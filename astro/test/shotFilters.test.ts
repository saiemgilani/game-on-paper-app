// BB-G38: the game page's shot filters behind 'bball-shot-filters'. The pure steps (shot type, assisted, clock, zone, the URL
// state, the ON/OFF test) on the real ingested finals (fixtures/<league>/game_*_api.json), the stints reads on real Data API
// reads (fixtures/README.md: game-stints-*.json.gz, captured with resources/gameStints.ts's own queries), the route's gate
// and the page in all four leagues. Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

interface Capture {
    league: 'nba' | 'wnba' | 'mbb' | 'wbb'; season: number; espnGameId: string; homeId: number; awayId: number
    crosswalk?: any[]; box?: any[]; stints: any[]; roster: { home: any[]; away: any[] }; pbp?: any[]
}
const capture = (name: string): Capture => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const CAPTURES: Record<Capture['league'], Capture> = {
    nba: capture('game-stints-nba-401909088'), // BOS 113 at DET 121, 2026-10-20 (stats 0022600001)
    wnba: capture('game-stints-wnba-401856890'), // CON 75 at NY 106, 2026-05-08 (stats 1022600001)
    mbb: capture('game-stints-mbb-401820775'), // NC State at Notre Dame, 2026-02-28 (contest 6456375)
    wbb: capture('game-stints-wbb-401805076'), // UTEP at Louisiana Tech, 2026 (contest 6402602)
};

// the Data API: retrieveRowsFrom answers from the capture by table (the crosswalk by team), recording each query
const api = vi.hoisted(() => ({ cap: null as any, calls: [] as { schema: string; table: string; query: Record<string, string> }[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        const c: Capture = api.cap;
        if (table === 'schedule_crosswalk') return c.crosswalk ?? [];
        if (table === 'ncaa_player_box') return c.box ?? [];
        if (table === 'game_stints') return c.stints;
        if (table === 'player_crosswalk' || table === 'ncaa_player_crosswalk') return String(query.espn_team_id) === String(c.homeId) ? c.roster.home : c.roster.away;
        throw new Error(`unexpected table ${table}`);
    },
}));
const stintsFn = vi.hoisted(() => ({ fn: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('../src/resources/gameStints', async (orig) => {
    const real = await orig<typeof import('../src/resources/gameStints')>();
    return { ...real, retrieveGameStints: (...a: Parameters<typeof real.retrieveGameStints>) => (stintsFn.fn ? stintsFn.fn(...a) : real.retrieveGameStints(...a)) };
});
const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { retrieveGameStints, type GameStints } from '../src/resources/gameStints';
import { fromDataApi, type NbaGame } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { shotsOf } from '../src/nba/data/game';
import { clockSeconds, filterShot, isAssisted, matches, NO_FILTERS, onFloor, parseFilters, shotKind, shotLine, withFilters, type FilterOptions } from '../src/basketball/shotFilters';
import { courtFor } from '../src/basketball/config';
import { leagueContextFromRows } from '../src/nba/adapters';
import type { BasketballLeague } from '../src/utils/league';

const json = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)).toString());
/** The real ingested finals: the stints ones (college) and the BB-G39 pro ones (2025, before the pro stints). */
const GAMES: Record<BasketballLeague, string> = { nba: '401766458', wnba: '401736287', mbb: '401820775', wbb: '401805076' };
const gameApi = (league: BasketballLeague) => json(`${league}/game_${GAMES[league]}_api.json`);
const game = (league: BasketballLeague): NbaGame => fromDataApi(gameApi(league), league);
const LEAGUES = ['nba', 'wnba', 'mbb', 'wbb'] as const;
const FG = (p: { shooting_play: unknown; type_text: string | null }) => String(p.shooting_play) === 'true' && !/free ?throw/i.test(p.type_text ?? '');

describe('each shot\'s filter fields on the real finals', () => {
    for (const league of LEAGUES) {
        test(`${league}: every field goal has a shot type, and the assisted makes are the team box's assists`, () => {
            const g = game(league);
            const fgs = g.plays.filter((p) => p.shootingPlay && !/free ?throw/i.test(p.typeText ?? ''));
            expect(fgs.length).toBeGreaterThan(100);
            expect(fgs.filter((p) => shotKind(p.typeText, p.text) === 'other')).toEqual([]);
            for (const side of [g.home, g.away]) {
                const made = fgs.filter((p) => p.teamId === Number(side.team.id) && isAssisted(p)).length;
                // the pros' text names every credited passer; in each college final one team's box credits one assist whose
                // make's text names nobody (ND 15 vs 14, LA Tech 17 vs 16; the other side exact)
                if (league === 'nba' || league === 'wnba') expect(made).toBe(side.box!.assists);
                else expect([0, 1]).toContain(side.box!.assists! - made);
            }
            expect(fgs.filter((p) => !p.scoringPlay && isAssisted(p))).toEqual([]);
            expect(fgs.every((p) => clockSeconds(p.clock) != null)).toBe(true);
        });
    }
    test('shotKind: the first type that matches, the text when the type says nothing', () => {
        expect(shotKind('Alley Oop Dunk Shot', '')).toBe('dunk');
        expect(shotKind('Layup Shot Putback', '')).toBe('layup');
        expect(shotKind('Tip Dunk Shot', '')).toBe('dunk');
        expect(shotKind('Turnaround Hook Shot', '')).toBe('hook');
        expect(shotKind('Step Back Jump Shot', '')).toBe('jumper');
        expect(shotKind('LayUpShot', '')).toBe('layup');
        expect(shotKind(null, 'Jane Doe made Three Point Jumper.')).toBe('jumper');
        expect(shotKind('Shot', 'a heave')).toBe('other');
    });
    test('clockSeconds: M:SS, sub-minute tenths, nothing', () => {
        expect(clockSeconds('5:23')).toBe(323);
        expect(clockSeconds('12:00')).toBe(720);
        expect(clockSeconds('45.2')).toBe(45.2);
        expect(clockSeconds('0.0')).toBe(0);
        expect(clockSeconds('')).toBeNull();
        expect(clockSeconds('--')).toBeNull();
    });
    test('a shot at the WNBA\'s placeholder location (through 2010) or unlocated has no zone; a located one has its zone', () => {
        const g = fromDataApi(json('wnba/game_250603003_api.json'), 'wnba');
        const court = courtFor('wnba', g.season);
        const at = { x: 0, y: 0, through: 2010 };
        const xs = shotsOf(g.plays, Number(g.home.team.id)).map((p) => filterShot(p, { x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || 2, label: '', period: p.period }, court, at));
        expect(xs.filter((x) => x.x === 0 && x.y === 0).every((x) => x.zone === '')).toBe(true);
        expect(xs.filter((x) => !(x.x === 0 && x.y === 0)).every((x) => x.zone !== '')).toBe(true);
    });
});

describe('the URL state', () => {
    const o: FilterOptions = { players: ['11', '12'], periods: ['1', '2', '3', '4'], zones: ['paint', 'mid_range'], kinds: ['layup', 'jumper'], withPlayers: ['11', '21'] };
    test('parse keeps only what the page offers', () => {
        const f = parseFilters(new URLSearchParams('shot_team=home&shot_player=11&shot_period=9&shot_result=made&shot_zone=paint&shot_type=dunk&shot_assist=ast&shot_off=21&order=oldest'), o);
        expect(f).toEqual({ ...NO_FILTERS, team: 'home', player: '11', result: 'made', zone: 'paint', assist: 'ast', with: '21', withMode: 'off' });
        expect(parseFilters(new URLSearchParams('shot_team=both&shot_player=99&shot_on=99'), o)).toEqual(NO_FILTERS);
    });
    test('withFilters writes the non-defaults and keeps every other param; round-trips', () => {
        const f = { ...NO_FILTERS, period: '2', kind: 'jumper', with: '11' };
        const u = withFilters(new URL('https://gameonpaper.com/nba/game/1?order=oldest&shot_zone=paint&shot_off=21#plays'), f);
        expect(u.search).toBe('?order=oldest&shot_period=2&shot_type=jumper&shot_on=11');
        expect(u.hash).toBe('#plays');
        expect(parseFilters(u.searchParams, o)).toEqual(f);
        expect(withFilters(u, NO_FILTERS).search).toBe('?order=oldest');
    });
});

describe('shotLine', () => {
    test('FG, 2P, 3P, eFG and points per shot', () => {
        const s = (made: boolean, value: number) => ({ made, value });
        expect(shotLine([s(true, 2), s(false, 2), s(true, 3), s(false, 3)])).toBe('FG 2-4 (50.0%), 2P 1-2 (50.0%), 3P 1-2 (50.0%), eFG 62.5%, 1.25 points per shot');
        expect(shotLine([s(true, 2)])).toBe('FG 1-1 (100.0%), 2P 1-1 (100.0%), 3P 0-0, eFG 100.0%, 2.00 points per shot');
        expect(shotLine([])).toBe('');
    });
});

describe('the stints reads', () => {
    beforeEach(() => { api.calls = []; api.fail = false; stintsFn.fn = null; });
    for (const league of LEAGUES) {
        test(`${league}: season-filtered, capped reads, mapped to ESPN ids; five of the shooting team on the floor at every attempt`, async () => {
            const c = CAPTURES[league]; api.cap = c;
            const stints = await retrieveGameStints(league, c.season, c.espnGameId, c.homeId, c.awayId);
            const pro = league === 'nba' || league === 'wnba';
            expect(api.calls.map((x) => x.table)).toEqual([pro ? 'schedule_crosswalk' : 'ncaa_player_box', 'game_stints', ...(pro ? ['player_crosswalk', 'player_crosswalk'] : ['ncaa_player_crosswalk', 'ncaa_player_crosswalk'])]);
            for (const x of api.calls) { expect(x.query.season).toBe(String(c.season)); expect(Number(x.query.limit)).toBeLessThanOrEqual(600); }
            const stintCall = api.calls.find((x) => x.table === 'game_stints')!;
            expect(stintCall.query.game_id).toBe(pro ? c.crosswalk![0][`${league}_game_id`] : c.box![0].contest_id);
            expect(stintCall.schema).toBe({ nba: 'nba_stats', wnba: 'wnba_stats', mbb: 'mbb', wbb: 'wbb' }[league]);
            // every player the crosswalk maps, by his ESPN id; the 2026 WNBA crosswalk misses one of the game's 19
            const players = new Set(c.stints.map((r) => String(r.player_id)));
            expect(Object.keys(stints).length).toBe(league === 'wnba' ? players.size - 1 : players.size);
            expect(Object.values(stints).flat().length).toBeLessThanOrEqual(c.stints.length);
            // the [clock_out, clock_in) rule against the game's own field goal attempts
            const pbp: any[] = pro ? c.pbp! : gameApi(league).pbp;
            const roster = (rows: any[]) => new Set(rows.map((r) => String(r.espn_athlete_id)));
            const teams = { [c.homeId]: roster(c.roster.home), [c.awayId]: roster(c.roster.away) };
            const counts = new Map<number, number>();
            for (const p of pbp.filter(FG)) {
                const secs = clockSeconds(p.clock_display_value)!;
                const on = Object.entries(stints).filter(([id, st]) => teams[Number(p.team_id)]?.has(id) && onFloor(st, Number(p.period_number), secs)).length;
                counts.set(on, (counts.get(on) ?? 0) + 1);
            }
            const total = pbp.filter(FG).length;
            expect(total).toBeGreaterThan(100);
            if (league === 'wnba') expect([...counts.keys()].every((n) => n === 4 || n === 5)).toBe(true); // the unmapped player's stretches
            else expect(counts.get(5)).toBe(total);
        });
    }
    test('unmapped game: no stints, no further read', async () => {
        api.cap = { ...CAPTURES.nba, crosswalk: [] };
        expect(await retrieveGameStints('nba', 2027, '401909088', 8, 2)).toEqual({});
        expect(api.calls.map((x) => x.table)).toEqual(['schedule_crosswalk']);
        api.calls = []; api.cap = { ...CAPTURES.mbb, box: [] };
        expect(await retrieveGameStints('mbb', 2026, '401820775', 87, 152)).toEqual({});
        expect(api.calls.map((x) => x.table)).toEqual(['ncaa_player_box']);
    });
    test('strict: an outage rejects, it is not "no stints"', async () => {
        api.cap = CAPTURES.mbb; api.fail = true;
        await expect(retrieveGameStints('mbb', 2026, '401820775', 87, 152)).rejects.toThrow();
    });
});

describe('the ON/OFF filter on the real college final', () => {
    test('with and without a player split the clocked shots in two', async () => {
        const c = CAPTURES.mbb; api.cap = c; api.calls = []; api.fail = false;
        const stints = await retrieveGameStints('mbb', c.season, c.espnGameId, c.homeId, c.awayId);
        const g = game('mbb');
        const court = courtFor('mbb', g.season);
        const xs = [g.home, g.away].flatMap((s) => shotsOf(g.plays, Number(s.team.id)).map((p) => filterShot(p, { x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || 2, label: '', period: p.period }, court, null)));
        for (const id of Object.keys(stints).slice(0, 4)) {
            const on = xs.filter((x) => matches(x, { ...NO_FILTERS, with: id, withMode: 'on' }, stints));
            const off = xs.filter((x) => matches(x, { ...NO_FILTERS, with: id, withMode: 'off' }, stints));
            expect(on.length + off.length).toBe(xs.length);
            expect(on.length).toBeGreaterThan(0);
            expect(on.some((x) => off.includes(x))).toBe(false);
        }
        // the chosen player's own shots all come while he is on
        const shooter = Object.keys(stints).find((id) => xs.some((x) => x.shooter === id))!;
        expect(xs.filter((x) => x.shooter === shooter).every((x) => matches(x, { ...NO_FILTERS, with: shooter }, stints))).toBe(true);
        // no stints for him: the filter matches nothing rather than everything
        expect(xs.filter((x) => matches(x, { ...NO_FILTERS, with: '1' }, stints))).toEqual([]);
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: GAMES.nba }, url: new URL(`https://gameonpaper.com/nba/game/${GAMES.nba}`), locals: { ...locals, flagOverrides: { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-game-shooting': false, ...(locals.flagOverrides as object) } }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const espnPage = (name: string, completed: boolean) => ({ page: { gameId: 401766458, gamepackageJSON: { header: { competitions: [{ date: '2025-04-15T23:30Z', status: { type: { name, completed } }, competitors: [] }] } } }, regressed: false });

describe('prepareBasketballGame', () => {
    const ingested = () => { sched.mockResolvedValueOnce(gameApi('nba').schedule[0]); rows.mockResolvedValueOnce(gameApi('nba')); };
    let fn = vi.fn();
    beforeEach(() => { [sched, rows, proc, espn].forEach((f) => f.mockReset()); fn = vi.fn(async () => ({})); stintsFn.fn = fn; });
    test("'bball-shot-filters' is a preview flag", () => { expect(FLAGS['bball-shot-filters']).toBe('preview'); });
    test('off: no read and no shotFilters key', async () => {
        ingested();
        expect('shotFilters' in (await prepareBasketballGame(fakeAstro({ preview: true, flagOverrides: { 'bball-shot-filters': false } }).astro, 'nba'))).toBe(false);
        ingested();
        expect('shotFilters' in (await prepareBasketballGame(fakeAstro({}).astro, 'nba'))).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });
    test('on, an ingested final: one read by the season and the ESPN ids, the year-long cache kept for an old final', async () => {
        const st: GameStints = { 1: [[1, 720, 300]] }; stintsFn.fn = fn = vi.fn(async () => st); ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        const s = gameApi('nba').schedule[0];
        expect(fn).toHaveBeenCalledWith('nba', 2025, GAMES.nba, Number(s.home_id), Number(s.away_id));
        expect('shotFilters' in r && r.shotFilters).toEqual({ stints: st });
        expect((cache.at(-1) as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
        // a season before the stints: none, and the old final keeps its year
        stintsFn.fn = async () => ({}); ingested();
        const again = fakeAstro({ preview: true });
        expect('shotFilters' in (await prepareBasketballGame(again.astro, 'nba'))).toBe(true);
        expect((again.cache.at(-1) as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });
    test('on, a recent final with no stints yet: held for the season window', async () => {
        stintsFn.fn = async () => ({});
        const recent = gameApi('nba'); recent.schedule[0].date = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        sched.mockResolvedValueOnce(recent.schedule[0]); rows.mockResolvedValueOnce(recent);
        const { astro, cache } = fakeAstro({ preview: true });
        await prepareBasketballGame(astro, 'nba');
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, a failed read: stints null, the page renders, nothing is cached', async () => {
        stintsFn.fn = async () => { throw new Error('down'); }; ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('shotFilters' in r && r.shotFilters).toEqual({ stints: null });
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('on, a live game: the filters without stints, no read', async () => {
        sched.mockResolvedValueOnce(null);
        espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false));
        const live = json('nba/game_401766458_processor.json'); live.status = { ...live.status, completed: false, name: 'STATUS_IN_PROGRESS' };
        proc.mockResolvedValueOnce(live);
        const r = await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'nba');
        expect('shotFilters' in r && r.shotFilters).toEqual({ stints: null });
        expect(fn).not.toHaveBeenCalled();
    });
});

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const page = async (league: BasketballLeague, g: NbaGame, shotFilters?: { stints: GameStints | null }, query = '') =>
    normalize(await container.renderToString(NbaGamePage, { props: { game: g, ...(shotFilters ? { shotFilters } : {}) }, request: new Request(`https://gameonpaper.com/${league}/game/${g.id}${query}`), locals: { league } as App.Locals }));
const panel = (html: string) => html.split('id="shots"')[1].split('id="plays"')[0];
/** The island's serialized props (Astro's `props` attribute), decoded. */
const islandProps = (html: string) => {
    const m = /component-url="[^"]*GameShotFilters\.svelte"[^>]*props="([^"]*)"/.exec(html) ?? /props="([^"]*)"[^>]*component-url="[^"]*GameShotFilters\.svelte"/.exec(html);
    return m ? m[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'") : '';
};

describe('NbaGamePage', () => {
    for (const league of LEAGUES) {
        test(`${league}: one filter island for both teams; outside the panel the page is the flag-off page`, async () => {
            const g = game(league);
            const off = await page(league, g);
            const html = await page(league, g, { stints: null });
            const shots = panel(html);
            expect(shots).toContain('GameShotFilters.svelte');
            expect(shots).not.toContain('GameShotChart.svelte');
            expect(shots).toContain('aria-label="Shot filters"');
            expect(shots).toContain('points per shot');
            expect(shots).not.toContain('On or off the floor'); // no stints, no ON/OFF menu
            expect(shots).not.toContain('NaN');
            expect(html.split('id="shots"')[0]).toBe(off.split('id="shots"')[0]);
            expect(html.split('id="plays"')[1]).toBe(off.split('id="plays"')[1]);
            expect(panel(off)).toContain('GameShotChart.svelte');
        });
    }
    test('college with its stints: the ON/OFF menu lists the box\'s players who have stints, by their ESPN ids', async () => {
        const c = CAPTURES.mbb; api.cap = c; api.calls = []; api.fail = false; stintsFn.fn = null;
        const stints = await retrieveGameStints('mbb', c.season, c.espnGameId, c.homeId, c.awayId);
        const g = game('mbb');
        const shots = panel(await page('mbb', g, { stints }));
        expect(shots).toContain('On or off the floor');
        const names = [...g.home.players, ...g.away.players].filter((p) => stints[String(p.athlete_id)]).map((p) => p.name);
        expect(names.length).toBe(Object.keys(stints).length);
        for (const n of names) expect(shots).toContain(`>${n.replaceAll("'", '&#39;')}</option>`);
    });
    test('with the league curve (BB-G39): each team keeps its linked chart, signature and bars; a chosen shooter\'s are his own', async () => {
        const g = game('mbb');
        const ctx = leagueContextFromRows(json('mbb/dashboards/league_context_2026.json'));
        const render = async (query = '') => normalize(await container.renderToString(NbaGamePage, { props: { game: g, shooting: ctx, shotFilters: { stints: null } }, request: new Request(`https://gameonpaper.com/mbb/game/${g.id}${query}`), locals: { league: 'mbb' } as App.Locals }));
        const both = panel(await render());
        expect(both.match(/<div data-shot-link[^>]*>/g)).toHaveLength(2);
        expect(both.match(/Shooting signature/g)).toHaveLength(2);
        // the one bar chart per team carries #444's Share / FG% toggle, FG% first
        expect(both.match(/aria-pressed="true"[^>]*>FG%<\/button>/g)).toHaveLength(2);
        expect(both.match(/aria-pressed="false"[^>]*>Share<\/button>/g)).toHaveLength(2);
        expect(both).toContain(`${g.home.team.displayName} FG% by distance vs league`);
        const p = g.home.players.find((r) => g.plays.some((x) => x.athleteId === r.athlete_id && x.shootingPlay && x.xLegacy != null && !(x.xLegacy === 0 && x.yLegacy === 0)))!;
        const one = panel(await render(`?shot_player=${p.athlete_id}`));
        expect(one.match(/<div data-shot-link[^>]*>/g)).toHaveLength(1);
        expect(one).toContain(`${p.name.replaceAll("'", '&#39;')} FG% by distance vs league`);
    });
    test('the URL\'s filters are the first render; a value the page does not offer is dropped', async () => {
        const g = game('mbb');
        const shooter = String(g.home.players.find((p) => g.plays.some((x) => x.athleteId === p.athlete_id && x.shootingPlay && x.xLegacy != null))!.athlete_id);
        const props = islandProps(await page('mbb', g, { stints: null }, `?shot_player=${shooter}&shot_result=made&shot_zone=nowhere`));
        expect(props).toContain(`"player":[0,"${shooter}"]`);
        expect(props).toContain('"result":[0,"made"]');
        expect(props).toContain('"zone":[0,""]');
        const html = await page('mbb', g, { stints: null }, `?shot_player=${shooter}`);
        // a chosen player: his team's chart alone
        expect(panel(html).match(/<h3 class="h6"/g)).toHaveLength(1);
    });
});
