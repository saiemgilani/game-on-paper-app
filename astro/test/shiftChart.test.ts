// BB-G36: the game page's shift chart behind 'bball-shift-chart'. The stints reads on real Data API reads (fixtures/README.md:
// game-stints-*.json.gz, captured with resources/gameStints.ts's own queries), the chart on the real college finals those
// stints belong to (fixtures/<league>/game_*_api.json), the highlight hook BB-G37 links to, the route's gate and the page in
// all four leagues. Every Data API read here is mocked.
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

interface Capture {
    league: 'nba' | 'wnba' | 'mbb' | 'wbb'; season: number; espnGameId: string; homeId: number; awayId: number
    crosswalk?: any[]; box?: any[]; stints: any[]; roster: { home: any[]; away: any[] }; impact: any[]
}
const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const CAPTURES: Record<Capture['league'], Capture> = {
    nba: gz('game-stints-nba-401909088'), // BOS 113 at DET 121, 2026-10-20 (stats 0022600001)
    wnba: gz('game-stints-wnba-401856890'), // CON 75 at NY 106, 2026-05-08 (stats 1022600001)
    mbb: gz('game-stints-mbb-401820775'), // NC State at Notre Dame, 2026-02-28 (contest 6456375)
    wbb: gz('game-stints-wbb-401805076'), // UTEP at Louisiana Tech, 2026 (contest 6402602)
};

const api = vi.hoisted(() => ({ cap: null as any, calls: [] as { schema: string; table: string; query: Record<string, string> }[] }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        const c: Capture = api.cap;
        if (table === 'schedule_crosswalk') return c.crosswalk ?? [];
        if (table === 'ncaa_player_box') return c.box ?? [];
        if (table === 'game_stints') return c.stints;
        if (table === 'game_player_impact') return c.impact;
        if (table === 'player_crosswalk' || table === 'ncaa_player_crosswalk') return String(query.espn_team_id) === String(c.homeId) ? c.roster.home : c.roster.away;
        throw new Error(`unexpected table ${table}`);
    },
}));
const rowsFn = vi.hoisted(() => ({ fn: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('../src/resources/gameStints', async (orig) => {
    const real = await orig<typeof import('../src/resources/gameStints')>();
    return { ...real, retrieveShiftReads: (...a: Parameters<typeof real.retrieveShiftReads>) => (rowsFn.fn ? rowsFn.fn(...a) : real.retrieveShiftReads(...a)) };
});
const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { retrieveGameStints, retrieveShiftReads, type MappedStint, type ShiftReads } from '../src/resources/gameStints';
import { retrieveImpactBox } from '../src/resources/impactBox';
import { fromDataApi, type NbaGame } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { intersect, mmss, parseShiftOn, pmClass, shiftHref, shiftView } from '../src/basketball/shiftChart';
import { regulationFor } from '../src/basketball/config';
import type { BasketballLeague } from '../src/utils/league';

const json = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)).toString());
/** The ingested finals: the college ones are the stints captures' games; the pro ones (2025) predate the pro stints. */
const GAMES: Record<BasketballLeague, string> = { nba: '401766458', wnba: '401736287', mbb: '401820775', wbb: '401805076' };
const gameApi = (league: BasketballLeague) => json(`${league}/game_${GAMES[league]}_api.json`);
const game = (league: BasketballLeague): NbaGame => fromDataApi(gameApi(league), league);
const LEAGUES = ['nba', 'wnba', 'mbb', 'wbb'] as const;
const minutesOf = (g: NbaGame, league: BasketballLeague) => regulationFor(league, g.season, g.regulation).periodMinutes;
const stintRows = async (league: BasketballLeague) => { const c = CAPTURES[league]; api.cap = c; return retrieveShiftReads(league, c.season, c.espnGameId, c.homeId, c.awayId); };
const NONE: ShiftReads = { stints: [], minutes: {} };

describe('the stints reads', () => {
    beforeEach(() => { api.calls = []; rowsFn.fn = null; });
    for (const league of LEAGUES) {
        test(`${league}: one season-filtered, capped stints read, each mapped row whole with its side`, async () => {
            const c = CAPTURES[league];
            const reads = await stintRows(league);
            const mapped = reads.stints;
            const stintCalls = api.calls.filter((x) => x.table === 'game_stints');
            expect(stintCalls).toHaveLength(1);
            expect(stintCalls[0].query).toMatchObject({ season: String(c.season), limit: '600' });
            expect(stintCalls[0].query.select.split(',')).toEqual(expect.arrayContaining(['pts', 'opp_pts', 'poss', 'opp_poss', 'plus_minus', 'seconds']));
            // the shot filters read the same query: one cache entry for both panels
            const before = api.calls.length;
            await retrieveGameStints(league, c.season, c.espnGameId, c.homeId, c.awayId);
            expect(api.calls.slice(before).find((x) => x.table === 'game_stints')!.query).toEqual(stintCalls[0].query);
            expect(mapped.length).toBeGreaterThan(50);
            const sideOf = (id: string) => (c.roster.home.some((r) => String(r.espn_athlete_id) === id) ? 'home' : 'away');
            for (const r of mapped) expect(r.side).toBe(sideOf(r.espn));
            // a stint's +/- is its points less its opponent's
            for (const r of mapped) expect(r.plus_minus).toBe(r.pts! - r.opp_pts!);
            // #455 Q6: the minutes are the producer's game line, read by the Impact box's own query (one cache entry), mapped to ESPN ids
            const impactCalls = api.calls.filter((x) => x.table === 'game_player_impact');
            expect(impactCalls).toHaveLength(1);
            const boxStart = api.calls.length;
            await retrieveImpactBox(league, c.season, c.espnGameId, c.homeId, c.awayId).catch(() => null);
            expect(api.calls.slice(boxStart).find((x) => x.table === 'game_player_impact')?.query).toEqual(impactCalls[0].query);
            const idCol = league === 'nba' || league === 'wnba' ? `${league}_player_id` : 'ncaa_player_id';
            const espnOf = new Map([...c.roster.home, ...c.roster.away].filter((r) => r[idCol] != null).map((r) => [String(r[idCol]), String(r.espn_athlete_id)]));
            const expected = Object.fromEntries(c.impact.filter((p) => espnOf.has(String(p.player_id))).map((p) => [espnOf.get(String(p.player_id)), p.minutes]));
            expect(reads.minutes).toEqual(expected);
            expect(Object.keys(reads.minutes).length).toBeGreaterThan(15);
            // the shot filters' read stays without it
            const filterStart = api.calls.length;
            await retrieveGameStints(league, c.season, c.espnGameId, c.homeId, c.awayId);
            expect(api.calls.slice(filterStart).some((x) => x.table === 'game_player_impact')).toBe(false);
        });
    }
    for (const league of LEAGUES) {
        test(`${league}: each player's stints add up to the Impact box's game line (same game, game_player_impact)`, () => {
            if (league === 'nba' || league === 'wnba') {
                const impact = gz(`impact-box-${league}-${league === 'nba' ? 2027 : 2026}`);
                expect(impact.espnGameId).toBe(CAPTURES[league].espnGameId);
                expect(CAPTURES[league].impact).toEqual(impact.players);
            }
            for (const p of CAPTURES[league].impact) {
                const st = CAPTURES[league].stints.filter((r) => String(r.player_id) === String(p.player_id));
                const sum = (k: string) => st.reduce((s, r) => s + r[k], 0);
                expect([sum('pts'), sum('opp_pts'), sum('poss'), sum('opp_poss'), sum('plus_minus')]).toEqual([p.pts, p.opp_pts, p.poss, p.opp_poss, p.plus_minus]);
                expect(sum('seconds') / 60).toBeCloseTo(p.minutes, 6);
            }
        });
    }
});

describe('the chart on the real college finals', () => {
    for (const league of ['mbb', 'wbb'] as const) {
        test(`${league}: starters first, five a side on the floor all game, bars inside the game and never overlapping`, async () => {
            const g = game(league);
            const v = shiftView(g, await stintRows(league), minutesOf(g, league));
            const gameSecs = g.regulation * minutesOf(g, league) * 60 + (g.periods - g.regulation) * 300;
            // both finals went to overtime: a five-minute period after regulation
            expect(g.periods).toBe(g.regulation + 1);
            expect(v.periods.map((p) => p.label)).toEqual([...Array.from({ length: g.regulation }, (_, i) => `${g.periodKind === 'half' ? 'H' : 'Q'}${i + 1}`), 'OT']);
            expect(v.periods[0].at).toBe(0);
            expect(v.highlighted).toBe(false);
            for (const s of v.sides) {
                expect(s.rows.slice(0, 5).every((r) => r.starter)).toBe(true);
                expect(s.rows.slice(5).some((r) => r.starter)).toBe(false);
                // five on the floor for the whole game: the bars cover 5 x 100% of it
                const covered = s.rows.flatMap((r) => r.bars).reduce((n, b) => n + b.to - b.from, 0);
                expect(covered).toBeCloseTo(500, 6);
                // the row's minutes are the producer's game line, which its stints' seconds equal
                const total = s.rows.reduce((n, r) => { const [m, sec] = r.minutes.split(':').map(Number); return n + m * 60 + sec; }, 0);
                expect(total).toBe(5 * gameSecs);
                expect(s.gap).toBe(false);
                for (const r of s.rows) {
                    for (const [a, b] of r.bars.slice(0, -1).map((b, i) => [b, r.bars[i + 1]])) expect(a.to).toBeLessThanOrEqual(b.from + 1e-9);
                    for (const b of r.bars) { expect(b.from).toBeGreaterThanOrEqual(0); expect(b.to).toBeLessThanOrEqual(100); expect(b.label).toMatch(/^.+: ((H|Q)\d|OT) \d+:\d\d–\d+:\d\d \(\d+:\d\d\) · ([+−]\d+|0) · \d+–\d+ · \d+ poss, \d+ opp poss$/); }
                }
            }
        });
    }
    test('a highlighted unit: its rows marked, and its shared stretches the intersection of their stints', async () => {
        const g = game('mbb');
        const st = await stintRows('mbb');
        const starters = g.home.players.filter((p) => p.starter).map((p) => String(p.athlete_id));
        const v = shiftView(g, st, minutesOf(g, 'mbb'), starters);
        const home = v.sides.find((s) => s.key === 'home')!;
        expect(home.rows.filter((r) => r.on).map((r) => r.id).sort()).toEqual([...starters].sort());
        expect(v.sides.find((s) => s.key === 'away')!.together).toBeNull();
        // the starting five open the game together, and share no more than the least-used of them played
        expect(home.together!.bars[0].from).toBe(0);
        const secs = (m: string) => { const [a, b] = m.split(':').map(Number); return a * 60 + b; };
        expect(secs(home.together!.minutes)).toBeLessThanOrEqual(Math.min(...home.rows.filter((r) => r.on).map((r) => secs(r.minutes))));
        expect(secs(home.together!.minutes)).toBeGreaterThan(0);
        // a player the crosswalk misses leaves his team's minutes short of five on the floor: flagged
        const gapped = shiftView(g, { ...st, stints: st.stints.filter((r) => r.espn !== starters[0]) }, minutesOf(g, 'mbb'));
        expect(gapped.sides.map((s) => s.gap)).toEqual([false, true]);
        // one player alone: highlighted, no shared row
        expect(shiftView(g, st, minutesOf(g, 'mbb'), starters.slice(0, 1)).sides.find((s) => s.key === 'home')!.together).toBeNull();
    });
    test('a row\'s MIN is the producer\'s minutes, never a sum of its stints; no line, a dash', async () => {
        const g = game('mbb');
        const st = await stintRows('mbb');
        const id = String(g.home.players.find((p) => p.starter)!.athlete_id);
        expect(st.minutes[id]).toBeGreaterThan(0);
        const row = (reads: ShiftReads) => shiftView(g, reads, minutesOf(g, 'mbb')).sides.find((s) => s.key === 'home')!.rows.find((r) => r.id === id)!;
        expect(row(st).minutes).toBe(mmss(Math.round(st.minutes[id]! * 60)));
        expect(row({ ...st, minutes: { ...st.minutes, [id]: 12.5 } }).minutes).toBe('12:30');
        expect(row({ ...st, minutes: { ...st.minutes, [id]: null } }).minutes).toBe('—');
        const { [id]: _, ...rest } = st.minutes;
        expect(row({ ...st, minutes: rest }).minutes).toBe('—');
    });
    test('intersect, mmss and the fill', () => {
        expect(intersect([[0, 10], [20, 30]], [[5, 25]])).toEqual([[5, 10], [20, 25]]);
        expect(intersect([[0, 10]], [[10, 20]])).toEqual([]);
        expect([mmss(0), mmss(65), mmss(720), mmss(12.5)]).toEqual(['0:00', '1:05', '12:00', '0:12.5']);
        // #455 Q5: the site's green (won) / purple (lost) shading, four steps deeper with the margin up to 10 points
        expect([1, 3, 4, 6, 7, 9, 10, 25].map(pmClass)).toEqual(['6', '6', '7', '7', '8', '8', '9', '9'].map((n) => `hulk-bg-level-${n}`));
        expect([-1, -3, -4, -6, -7, -9, -10, -25].map(pmClass)).toEqual(['3', '3', '2', '2', '1', '1', '0', '0'].map((n) => `hulk-bg-level-${n}`));
        expect(pmClass(0)).toBe('hulk-bg-level-5');
        expect(pmClass(null)).toBe(pmClass(0));
    });
});

describe('the highlight hook (BB-G37 links here)', () => {
    test('shiftHref writes what parseShiftOn reads; junk, repeats and a sixth id are dropped', () => {
        expect(shiftHref([4433134, '4432158'])).toBe('?shift_on=4433134,4432158#shifts');
        expect(parseShiftOn(new URL(`https://x/mbb/game/1${shiftHref(['1', '2'])}`).searchParams)).toEqual(['1', '2']);
        expect(parseShiftOn(new URLSearchParams('shift_on=1,1,abc,2,3,4,5,6'))).toEqual(['1', '2', '3', '4', '5']);
        expect(parseShiftOn(new URLSearchParams(''))).toEqual([]);
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: GAMES.nba }, url: new URL(`https://gameonpaper.com/nba/game/${GAMES.nba}`), locals: { ...locals, flagOverrides: { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-game-shooting': false, 'bball-shot-filters': false, ...(locals.flagOverrides as object) } }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const espnPage = (name: string, completed: boolean) => ({ page: { gameId: 401766458, gamepackageJSON: { header: { competitions: [{ date: '2025-04-15T23:30Z', status: { type: { name, completed } }, competitors: [] }] } } }, regressed: false });

describe('prepareBasketballGame', () => {
    const ingested = () => { sched.mockResolvedValueOnce(gameApi('nba').schedule[0]); rows.mockResolvedValueOnce(gameApi('nba')); };
    let fn = vi.fn();
    beforeEach(() => { [sched, rows, proc, espn].forEach((f) => f.mockReset()); fn = vi.fn(async () => NONE); rowsFn.fn = fn; });
    test("'bball-shift-chart' is a preview flag", () => { expect(FLAGS['bball-shift-chart']).toBe('preview'); });
    test('off: no read and no shift key', async () => {
        ingested();
        expect('shift' in (await prepareBasketballGame(fakeAstro({ preview: true, flagOverrides: { 'bball-shift-chart': false } }).astro, 'nba'))).toBe(false);
        ingested();
        expect('shift' in (await prepareBasketballGame(fakeAstro({}).astro, 'nba'))).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });
    test('on, an ingested final: one read by the season and the ESPN ids; an old final with none keeps its year', async () => {
        const st: ShiftReads = { stints: [{ espn: '1' }] as MappedStint[], minutes: { 1: 30 } }; rowsFn.fn = fn = vi.fn(async () => st); ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        const s = gameApi('nba').schedule[0];
        expect(fn).toHaveBeenCalledWith('nba', 2025, GAMES.nba, Number(s.home_id), Number(s.away_id));
        expect('shift' in r && r.shift).toBe(st);
        expect((cache.at(-1) as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
        rowsFn.fn = async () => NONE; ingested();
        const again = fakeAstro({ preview: true });
        expect('shift' in (await prepareBasketballGame(again.astro, 'nba')) ).toBe(true);
        expect((again.cache.at(-1) as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });
    test('on, a recent final with no stints yet: held for the season window', async () => {
        const recent = gameApi('nba'); recent.schedule[0].date = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        sched.mockResolvedValueOnce(recent.schedule[0]); rows.mockResolvedValueOnce(recent);
        const { astro, cache } = fakeAstro({ preview: true });
        await prepareBasketballGame(astro, 'nba');
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, a failed read: shift null, the page renders, nothing is cached', async () => {
        rowsFn.fn = async () => { throw new Error('down'); }; ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('shift' in r && r.shift).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('on, a live game: no panel and no read', async () => {
        sched.mockResolvedValueOnce(null);
        espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false));
        const live = json('nba/game_401766458_processor.json'); live.status = { ...live.status, completed: false, name: 'STATUS_IN_PROGRESS' };
        proc.mockResolvedValueOnce(live);
        expect('shift' in (await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'nba'))).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });
});

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const page = async (league: BasketballLeague, g: NbaGame, shift?: ShiftReads | null, query = '') =>
    (await container.renderToString(NbaGamePage, { props: { game: g, ...(shift !== undefined ? { shift } : {}) }, request: new Request(`https://gameonpaper.com/${league}/game/${g.id}${query}`), locals: { league } as App.Locals }))
        .replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
const panel = (html: string) => html.split('id="shifts"')[1].split('id="shots"')[0];

describe('NbaGamePage', () => {
    beforeEach(() => { rowsFn.fn = null; api.calls = []; });
    for (const league of LEAGUES) {
        test(`${league}: the panel and its nav entry; outside them the page is the flag-off page`, async () => {
            const g = game(league);
            const off = await page(league, g);
            expect(off).not.toContain('id="shifts"');
            const college = league === 'mbb' || league === 'wbb';
            const html = await page(league, g, college ? await stintRows(league) : NONE);
            const body = panel(html);
            expect(html).toContain('href="#shifts"');
            expect(body).not.toContain('NaN');
            if (college) {
                expect(body.match(/class="shift-bar hulk-bg-level-\d"/g)!.length).toBe(CAPTURES[league].stints.length);
                // the key: nine shades from lost by 10+ (purple, level 0) to won by 10+ (green, level 9)
                const key = body.split('id="shifts-key"')[1].split('</p>')[0];
                expect([...key.matchAll(/hulk-bg-level-(\d)/g)].map((m) => m[1])).toEqual(['0', '1', '2', '3', '5', '6', '7', '8', '9']);
                expect(body).not.toMatch(/rgba\((33,102,172|230,97,1)/);
                // MIN: the producer's minutes, one starter's checked against the capture
                const s = g.home.players.find((p) => p.starter)!;
                const min = (await stintRows(league)).minutes[String(s.athlete_id)]!;
                expect(body.split(`data-player="${s.athlete_id}"`)[1]).toMatch(new RegExp(`<div class="shift-min numeral"[^>]*>${mmss(Math.round(min * 60))}</div>`));
                for (const p of [...g.home.players, ...g.away.players].filter((x) => x.starter)) expect(body).toContain(`data-player="${p.athlete_id}"`);
            } else {
                // the 2025 pro finals predate the pro stints: the note, no chart
                expect(body).toContain('id="shifts-empty"');
                expect(body).not.toContain('shift-bar');
            }
            // the panel, its nav entries and its scoped style cut out: the flag-off page
            const cut = html.replace(/<div class="panel-group" id="shifts-panel">[\s\S]*?(?=<div class="panel-group" id="shots-panel">)/, '')
                .replace(/<a href="#shifts"[^>]*>Shifts<\/a>/, '').replace(/<option value="#shifts">Shifts<\/option>/, '').replace(/<style>[^<]*\.shift-grid[^<]*<\/style>/, '');
            expect(cut).toBe(off);
            expect(html.split('id="shots"')[1]).toBe(off.split('id="shots"')[1]);
        });
    }
    test('a failed read: the note, the rest of the page', async () => {
        const body = panel(await page('mbb', game('mbb'), null));
        expect(body).toContain('id="shifts-unavailable"');
        expect(body).not.toContain('shift-bar');
    });
    test('?shift_on= highlights the unit and draws its shared row', async () => {
        const g = game('wbb');
        const ids = g.away.players.filter((p) => p.starter).slice(0, 3).map((p) => p.athlete_id);
        const body = panel(await page('wbb', g, await stintRows('wbb'), shiftHref(ids).replace('#shifts', '')));
        expect(body.match(/>Together</g)).toHaveLength(1);
        expect(body.match(/class="shift-row shift-dim/g)!.length).toBe(g.away.players.filter((p) => !p.did_not_play).length - 3);
    });
});
