// BB-G44: the game page's player props panel behind 'bball-props'. The read (season- and game-filtered, capped), the view
// on real Data API rows (fixtures/README.md: player-props.json.gz) against the same games' real box scores, the route's
// gate (flag, league, live and final, a failed read never cached) and the page (no panel without lines, byte for byte).
// Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string> }[], rows: [] as any[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        if (table === 'player_props') return api.rows;
        throw new Error(`unexpected table ${table}`);
    },
}));
const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { fromDataApi, fromProcessor, type NbaGame } from '../src/resources/nbaGame';
import { retrievePlayerProps, type PropRow } from '../src/resources/playerProps';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { actualStat, propResult, propsView } from '../src/utils/playerProps';

const PROPS = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/player-props.json.gz', import.meta.url))).toString()) as Record<string, { league: string; season: number; rows: PropRow[] }>;
const json = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());
const nbaGame = (): NbaGame => fromProcessor(json('nba/game_401705127_processor'), 'nba'); // a 2024-25 OT final
const mbbGame = (): NbaGame => fromDataApi(json('mbb/game_401808271_api'), 'mbb'); // a 2025-26 final
const live = (g: NbaGame): NbaGame => ({ ...g, status: { ...g.status, completed: false, name: 'STATUS_IN_PROGRESS' } });
const NBA = PROPS['nba-401705127'].rows, MBB = PROPS['mbb-401808271'].rows;

beforeEach(() => { api.calls.length = 0; api.rows = []; api.fail = false; [sched, rows, proc, espn].forEach((f) => f.mockReset()); });

describe('retrievePlayerProps', () => {
    test('one read by the season and the ESPN game id, capped', async () => {
        api.rows = NBA;
        expect(await retrievePlayerProps('nba', 2025, '401705127')).toHaveLength(NBA.length);
        expect(api.calls).toEqual([{ schema: 'nba', table: 'player_props', query: expect.objectContaining({ season: '2025', game_id: '401705127', limit: '300' }) }]);
    });
    test('a read at the cap is a failed read, never a short one; an outage throws', async () => {
        api.rows = Array.from({ length: 300 }, () => NBA[0]);
        await expect(retrievePlayerProps('nba', 2025, '401705127')).rejects.toThrow('cap');
        api.fail = true;
        await expect(retrievePlayerProps('mbb', 2026, '401808271')).rejects.toThrow('down');
    });
});

describe('propsView on real lines and the same games\' box scores', () => {
    test('NBA final: every matched line lands on a side, against the box score\'s count', () => {
        const game = nbaGame(), v = propsView(NBA, game)!;
        expect(v.final).toBe(true);
        expect(v.stats).toEqual(['points', 'rebounds', 'assists', 'threes', 'pra']);
        const boxOf = (id: number | null) => [...game.home.players, ...game.away.players].find((p) => p.athlete_id === id && !p.did_not_play);
        // three of the lines are for players out that night (no box row): void at the books, left out
        const played = NBA.filter((r) => boxOf(r.athlete_id));
        expect(NBA.length - played.length).toBeGreaterThan(0);
        const shown = [...v.home, ...v.away].reduce((n, p) => n + Object.keys(p.cells).length, 0);
        expect(shown).toBe(played.length);
        for (const r of played) {
            const s = game.home.players.some((p) => p.athlete_id === r.athlete_id) ? 'home' : 'away';
            const box = boxOf(r.athlete_id)!;
            const cell = v[s].find((p) => p.athleteId === r.athlete_id)!.cells[r.stat as 'points']!;
            const actual = r.stat === 'threes' ? Number(box.fg3.split('-')[0]) : r.stat === 'pra' ? box.points! + box.rebounds! + box.assists! : (box as any)[r.stat];
            expect(cell.actual, `${r.player_name} ${r.stat}`).toBe(actual);
            expect(cell.result).toBe(actual > r.line! ? 'over' : actual < r.line! ? 'under' : 'push');
            expect(cell.overProb).toBeCloseTo(r.over_prob!, 12);
        }
        // the books' biggest points line leads its side
        for (const s of ['home', 'away'] as const) {
            const pts = v[s].map((p) => p.cells.points?.line ?? -1);
            expect(pts).toEqual([...pts].sort((a, b) => b - a));
        }
    });
    test("Q34: the void players are named once each, the ones whose lines were left out", () => {
        const game = nbaGame(), v = propsView(NBA, game)!;
        const inBox = (id: number | null) => [...game.home.players, ...game.away.players].some((p) => p.athlete_id === id && !p.did_not_play);
        const onSide = (r: (typeof NBA)[number]) => [game.home, game.away].some((s) => Number(s.team.id) === Number(r.team_id) || s.players.some((p) => p.athlete_id === r.athlete_id));
        const want = [...new Set(NBA.filter((r) => r.athlete_id != null && onSide(r) && !inBox(r.athlete_id)).map((r) => r.athlete_id))];
        expect(want.length).toBeGreaterThan(0);
        expect(v.voided).toHaveLength(want.length);
        expect(new Set(v.voided).size).toBe(v.voided.length);
        // live, nothing is void yet: a player may still check in
        expect(propsView(NBA, live(nbaGame()))!.voided).toEqual([]);
    });
    test('MBB: points, rebounds and assists only', () => {
        const v = propsView(MBB, mbbGame())!;
        expect(v.stats).toEqual(['points', 'rebounds', 'assists']);
        expect([...v.home, ...v.away].length).toBeGreaterThan(0);
    });
    test('live: progress only, O once the line is cleared, never U or P', () => {
        const v = propsView(NBA, live(nbaGame()))!;
        const cells = [...v.home, ...v.away].flatMap((p) => Object.values(p.cells));
        expect(v.final).toBe(false);
        expect(cells.some((c) => c.result === 'over')).toBe(true);
        for (const c of cells) expect(c.result === null || (c.result === 'over' && c.actual! > c.line)).toBe(true);
    });
    test('no matched line: no view; an unmatched name is left out', () => {
        expect(propsView([], nbaGame())).toBeNull();
        expect(propsView([{ ...NBA[0], athlete_id: null, team_id: null }], nbaGame())).toBeNull();
    });
    test('propResult and actualStat edges', () => {
        expect(propResult(20, 20, true)).toBe('push');
        expect(propResult(20, 20, false)).toBeNull();
        expect(propResult(null, 1.5, true)).toBeNull();
        const p = nbaGame().home.players.find((x) => !x.did_not_play)!;
        expect(actualStat({ ...p, fg3: '–' }, 'threes')).toBeNull();
        expect(actualStat({ ...p, assists: null }, 'pra')).toBeNull();
        expect(actualStat({ ...p, did_not_play: true }, 'points')).toBeNull();
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    const flagOverrides = { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-garbage-time': false, ...(locals.flagOverrides as object) };
    return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { ...locals, flagOverrides }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const gameApi = () => json('nba/game_401766458_api'); // MIL-CHI, a 2024-25 final, ingested
const ingested = () => { sched.mockResolvedValueOnce(gameApi().schedule[0]); rows.mockResolvedValueOnce(gameApi()); };
const espnPage = (name: string, completed: boolean) => ({ page: { gameId: 401766458, gamepackageJSON: { header: { competitions: [{ date: '2025-04-15T23:30Z', status: { type: { name, completed } }, competitors: [] }] } } }, regressed: false });
const liveGame = () => {
    sched.mockResolvedValueOnce(null);
    espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false));
    const j = json('nba/game_401766458_processor'); j.status = { ...j.status, completed: false, name: 'STATUS_IN_PROGRESS' };
    proc.mockResolvedValueOnce(j);
};
const propReads = () => api.calls.filter((c) => c.table === 'player_props');

describe('prepareBasketballGame', () => {
    test("'bball-props' is a preview flag", () => { expect(FLAGS['bball-props']).toBe('preview'); });
    test('off: no read and no playerProps key', async () => {
        ingested();
        expect('playerProps' in (await prepareBasketballGame(fakeAstro({}).astro, 'nba'))).toBe(false);
        ingested();
        expect('playerProps' in (await prepareBasketballGame(fakeAstro({ preview: true, flagOverrides: { 'bball-props': false } }).astro, 'nba'))).toBe(false);
        expect(propReads()).toEqual([]);
    });
    test('on, an ingested final: one read; no lines yet holds it for the season window, not a year', async () => {
        ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.playerProps).toEqual([]);
        expect(propReads().map((c) => [c.schema, c.query.season, c.query.game_id])).toEqual([['nba', '2025', '401766458']]);
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, a live game: read too (progress toward the line)', async () => {
        api.rows = NBA; liveGame();
        const r = await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'nba');
        expect('game' in r && r.game.status.completed).toBe(false);
        expect('game' in r && r.playerProps).toHaveLength(NBA.length);
    });
    test('women\'s college has no props: no read, no key', async () => {
        liveGame();
        const r = await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'wbb');
        expect('game' in r).toBe(true);
        expect('playerProps' in r).toBe(false);
        expect(propReads()).toEqual([]);
    });
    test('on, a failed read: playerProps null, the page renders, nothing is cached', async () => {
        api.fail = true; ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.playerProps).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const page = (game: NbaGame, league: string, playerProps?: PropRow[] | null) =>
    container.renderToString(NbaGamePage, { props: { game, ...(playerProps !== undefined ? { playerProps } : {}) }, locals: { league } as App.Locals });

describe('NbaGamePage', () => {
    test('no lines or none matched: byte for byte the page without the flag', async () => {
        const game = nbaGame(), off = await page(game, 'nba');
        expect(await page(game, 'nba', [])).toBe(off);
        expect(await page(game, 'nba', [{ ...NBA[0], athlete_id: null, team_id: null }])).toBe(off);
        expect(off).not.toContain('id="props"');
    });
    test('final: the panel, its nav entry, both sides, lines, chances and O / U marks', async () => {
        const html = await page(nbaGame(), 'nba', NBA);
        expect(html).toContain('href="#props"');
        expect(html).toContain('id="props-home"');
        expect(html).toContain('id="props-away"');
        expect(html).toMatch(/title="Over">O</);
        expect(html).toMatch(/title="Under">U</);
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('progressbar');
    });
    test('Q34: a final names its void lines under the tables; live has no such line', async () => {
        const v = propsView(NBA, nbaGame())!;
        const html = await page(nbaGame(), 'nba', NBA);
        const line = html.split('id="props-void"')[1].split('</p>')[0];
        expect(line).toContain(`${v.voided.length} ${v.voided.length === 1 ? 'player&#39;s lines' : 'players&#39; lines'} void: did not play (`);
        for (const n of v.voided) expect(line).toContain(n);
        expect(html.indexOf('id="props-home"')).toBeLessThan(html.indexOf('id="props-void"'));
        expect(await page(live(nbaGame()), 'nba', NBA)).not.toContain('id="props-void"');
    });
    test('live: progress bars, no U marks', async () => {
        const html = await page(live(nbaGame()), 'nba', NBA);
        expect(html).toContain('role="progressbar"');
        expect(html).not.toMatch(/title="Under">U</);
        expect(html).toContain('the count so far');
    });
    test('MBB: three stat columns', async () => {
        const html = await page(mbbGame(), 'mbb', MBB);
        const head = html.split('id="props-home"')[1].split('</thead>')[0];
        expect(head.match(/<th scope="col" class="text-end"/g)).toHaveLength(3);
    });
    test('a failed read says so', async () => {
        expect(await page(nbaGame(), 'nba', null)).toContain('id="props-unavailable"');
    });
});
