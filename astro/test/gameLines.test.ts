// BB-G43: the Lines and markets panel behind 'bball-lines'. The cover and total results against the producer's own
// (sdv-db game_lines' ats_result / total_result on real rows, fixtures/README.md: game-lines.json), the upset tag, the live
// "at this pace" projection on a real play's clock, the read, the route's gate and cache, and the panel: final, live,
// a failed read and the flag-off page byte for byte. Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string>; ttl: unknown }[], rows: [] as any[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>, ttl: unknown) => {
        api.calls.push({ schema: source.schema, table, query, ttl });
        if (api.fail) throw new Error('down');
        if (table === 'game_lines') return api.rows;
        throw new Error(`unexpected table ${table}`);
    },
}));
const sched = vi.fn(), rows = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a) }));

vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGameSummary: async () => null }));
vi.mock('../src/resources/nbaShots', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaShots')>()), retrieveSeasonPlayerRows: async () => [] }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import NbaPreGamePage from '../src/components/nba/game/NbaPreGamePage.astro';
import { fromDataApi, type NbaGame } from '../src/resources/nbaGame';
import { retrieveGameLine } from '../src/resources/gameLines';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { LINES_FROM, UPSET_WP, cover, lineSpread, lineTotal, moneylineText, overUnder, pace, spreadText, upset, type GameLine } from '../src/utils/gameLines';

const FX = JSON.parse(readFileSync(new URL('./fixtures/game-lines.json', import.meta.url)).toString()) as { game_lines: GameLine[]; schedule: { league: string; id: number; home_score: number; away_score: number; home_abbreviation: string; away_abbreviation: string }[] };
const row = (id: number) => FX.game_lines.find((r) => Number(r.game_id) === id)!;
const score = (id: number) => FX.schedule.find((s) => s.id === id)!;
const gameApi = () => JSON.parse(readFileSync(new URL('./fixtures/nba/game_401766458_api.json', import.meta.url)).toString());

describe('results agree with the producer', () => {
    const played = FX.schedule.map((s) => ({ s, l: row(s.id) }));
    test('the fixture covers all four leagues', () => { expect(new Set(FX.schedule.map((s) => s.league))).toEqual(new Set(['nba', 'wnba', 'mbb', 'wbb'])); });
    test('cover and over/under against the close equal ats_result and total_result', () => {
        let n = 0;
        for (const { s, l } of played) {
            expect(l.home_margin).toBe(s.home_score - s.away_score);
            if (l.ats_result != null) { expect(cover(l.spread_home_close!, s.home_score, s.away_score), String(s.id)).toBe(l.ats_result); n++; }
            if (l.total_result != null) { expect(overUnder(l.total_close!, s.home_score, s.away_score), String(s.id)).toBe(l.total_result); n++; }
        }
        expect(n).toBe(15); // 8 covers, 7 totals (WKU-DEL has no total)
    });
    test('the close, else the open', () => {
        expect(lineSpread(row(401909088))).toBe(-1.5); // a 2026-27 row: open only
        expect(lineTotal(row(401805007))).toBeNull();
    });
    test("the upset tag: the winner under 35% in the market, the hub's cut (Q38)", () => {
        expect(UPSET_WP).toBe(0.35);
        const tags = played.map(({ s, l }) => [s.id, upset(l, s.home_score, s.away_score)]).filter(([, u]) => u);
        // WSH (+8, 26.5%) beat ATL; NY (+1.5, 46.8%) over CLE and SA (40.5%) at DAL were under 50% but are not upsets at 35%
        expect(tags.map(([id]) => id)).toEqual([401736112]);
        expect(tags[0][1]).toEqual({ side: 'home', wp: row(401736112).market_home_wp_close });
        expect(upset(row(401809234), 119, 111)).toBeNull();
        expect(upset(row(401809235), 92, 125)).toBeNull();
        // the cut itself: 34.9% tags, 35% does not
        const at = (hw: number) => upset({ ...row(401809234), market_home_wp_close: hw }, 1, 0);
        expect(at(0.349)?.wp).toBe(0.349);
        expect(at(0.35)).toBeNull();
        expect(upset(row(401736112), 100, 100)).toBeNull(); // no winner
    });
    test('the text', () => {
        expect(spreadText(-5.5, 'NY', 'CLE')).toBe('NY -5.5');
        expect(spreadText(1.5, 'NY', 'CLE')).toBe('CLE -1.5');
        expect(spreadText(0, 'NY', 'CLE')).toBe('PK');
        expect(moneylineText(105)).toBe('+105');
        expect(moneylineText(-125)).toBe('-125');
    });
});

describe('pace', () => {
    // a real play: ORL 68, MIL 59 with 6:37 left in the 3rd
    const p = gameApi().pbp.find((r: any) => Number(r.game_play_number) === 293);
    test('points so far over the elapsed clock, times regulation', () => {
        expect([p.period_number, p.clock_display_value, p.home_score, p.away_score].map(String)).toEqual(['3', '6:37', '68', '59']);
        const r = pace(3, '6:37', 4, 720, 68, 59)!;
        expect(r.elapsed).toBe(2 * 720 + 720 - 397);
        expect(r.home).toBeCloseTo((68 * 2880) / 1763, 9);
        expect(r.total).toBeCloseTo(r.home + r.away, 9);
    });
    test('college halves and the women\'s quarters', () => {
        expect(pace(2, '10:00', 2, 1200, 50, 40)!.total).toBeCloseTo(120, 9);
        expect(pace(4, '5:00', 4, 600, 60, 60)!.total).toBeCloseTo(137.142857, 5);
    });
    test('none before the tip, in overtime or without a clock', () => {
        expect(pace(1, '12:00', 4, 720, 0, 0)).toBeNull();
        expect(pace(5, '2:00', 4, 720, 100, 100)).toBeNull();
        expect(pace(null, '2:00', 4, 720, 10, 10)).toBeNull();
        expect(pace(2, null, 4, 720, 10, 10)).toBeNull();
        expect(pace(2, 'soon', 4, 720, 10, 10)).toBeNull();
        expect(pace(2, '0.0', 4, 720, 55, 50)!.total).toBeCloseTo(210, 9); // halftime
    });
});

describe('retrieveGameLine', () => {
    beforeEach(() => { api.calls = []; api.rows = []; api.fail = false; });
    test('one read by season and game id, from the league games schema', async () => {
        api.rows = [row(401809234)];
        expect(await retrieveGameLine('nba', 2026, '401809234')).toEqual(row(401809234));
        expect(api.calls).toHaveLength(1);
        expect(api.calls[0]).toMatchObject({ schema: 'nba', table: 'game_lines', query: { season: '2026', game_id: '401809234', limit: '2' } });
        const ttl = api.calls[0].ttl as (c: any) => number;
        expect(ttl({ data: [row(401809234)] })).toBe(60 * 60 * 24 * 365); // settled
        expect(ttl({ data: [row(401909088)] })).toBe(6 * 60 * 60); // open only, no result
        expect(ttl({ data: [] })).toBe(6 * 60 * 60);
    });
    test('no row is null; a failure throws; a season before the odds files is never read', async () => {
        expect(await retrieveGameLine('wbb', 2026, '1')).toBeNull();
        api.fail = true;
        await expect(retrieveGameLine('wbb', 2026, '1')).rejects.toThrow('down');
        api.calls = [];
        for (const lg of ['nba', 'wnba', 'mbb', 'wbb'] as const) expect(await retrieveGameLine(lg, LINES_FROM[lg] - 1, '1')).toBeNull();
        expect(await retrieveGameLine('nba', null, '1')).toBeNull();
        expect(api.calls).toEqual([]);
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { ...locals, flagOverrides: { 'bball-impact-box': false, 'bball-game-flow': false, ...(locals.flagOverrides as object) } }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareBasketballGame', () => {
    const ingested = () => { sched.mockResolvedValueOnce(gameApi().schedule[0]); rows.mockResolvedValueOnce(gameApi()); };
    beforeEach(() => { [sched, rows].forEach((f) => f.mockReset()); api.calls = []; api.rows = []; api.fail = false; });
    afterEach(() => { vi.useRealTimers(); });
    const YEAR = 60 * 60 * 24 * 300;
    test("'bball-lines' is a preview flag", () => { expect(FLAGS['bball-lines']).toBe('preview'); });
    test('off: no read and no lines key', async () => {
        ingested();
        const r = await prepareBasketballGame(fakeAstro({ preview: true, flagOverrides: { 'bball-lines': false } }).astro, 'nba');
        expect('game' in r && 'lines' in r).toBe(false);
        ingested();
        expect('lines' in (await prepareBasketballGame(fakeAstro({}).astro, 'nba'))).toBe(false); // no preview cookie
        expect(api.calls).toEqual([]);
    });
    test('on, a row: lines, the year-long final cache kept', async () => {
        api.rows = [row(401809235)]; ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.lines).toEqual(row(401809235));
        expect(api.calls[0].query).toMatchObject({ season: '2025', game_id: '401766458' });
        expect(cache).toHaveLength(1);
        expect((cache[0] as any).maxAge).toBeGreaterThan(YEAR);
    });
    test('on, no row: no key; an old final keeps its year, a recent one follows the nightly', async () => {
        ingested();
        const old = fakeAstro({ preview: true });
        expect('lines' in (await prepareBasketballGame(old.astro, 'nba'))).toBe(false);
        expect((old.cache.at(-1) as any).maxAge).toBeGreaterThan(YEAR);
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2025-05-01T00:00Z'));
        for (const rs of [[], [row(401909088)]]) { // no row; a row with no result yet
            api.rows = rs; ingested();
            const recent = fakeAstro({ preview: true });
            await prepareBasketballGame(recent.astro, 'nba');
            expect((recent.cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
        }
    });
    test('on, a failed read: lines null, the page renders, nothing is cached', async () => {
        api.fail = true; ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.lines).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/ ([;:,)])/g, '$1');
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
/** The fixture final relabelled as a game_lines row's teams and score. */
function gameAs(id: number, over: Partial<NbaGame['status']> = {}, scores?: [number, number]): NbaGame {
    const g = fromDataApi(gameApi(), 'nba'); const s = score(id);
    const [h, a] = scores ?? [s.home_score, s.away_score];
    const t = (side: typeof g.home, abbr: string, sc: number) => ({ ...side, score: sc, team: { ...side.team, abbreviation: abbr, displayName: abbr } });
    return { ...g, status: { ...g.status, ...over }, home: t(g.home, s.home_abbreviation, h), away: t(g.away, s.away_abbreviation, a) };
}
const page = async (game: NbaGame, lines?: GameLine | null) => container.renderToString(NbaGamePage, { props: { game, ...(lines !== undefined ? { lines } : {}) }, locals: { league: 'nba' } as App.Locals });
const lines = (html: string) => plain(html.split('id="lines-body"')[1].split('</div>')[0]);

describe('NbaGamePage', () => {
    test('absent: byte for byte the flag-off page', async () => {
        const g = gameAs(401809234);
        const off = await page(g);
        expect(off).not.toContain('id="lines"');
        expect(await page(g, undefined)).toBe(off);
    });
    test('a final: one column (open = close), the market beside our prior, the cover, the total and the upset', async () => {
        const html = await page(gameAs(401809234), row(401809234));
        expect(html).toContain('href="#lines"');
        const t = lines(html);
        expect(t).toContain('Line');
        expect(t).not.toContain('Open');
        expect(t).toMatch(/Spread CLE -1\.5 Total 229 Moneyline CLE -125 Moneyline NY \+105 Win % CLE \(no vig\) 53% Win % NY \(no vig\) 47%/);
        expect(t).toMatch(/Market pregame: CLE 53%; our pregame prior: (NY|CLE) \d+%/);
        expect(t).toContain('NY covered CLE -1.5; over 229 (230)');
        expect(t).not.toContain('Upset'); // NY at 47% is under 50% but not under 35%
        expect(t).toContain('Consensus of 11 books.');
        for (const bad of ['NaN', 'undefined', 'null']) expect(t).not.toContain(bad);
    });
    test('the Upset tag on a real under-35% win: WSH over ATL at 27% pregame', async () => {
        const t = lines(await page(gameAs(401736112), row(401736112)));
        expect(t).toMatch(/Upset WSH won at 2[67]% pregame/);
    });
    test('open and latest when they differ; a missing total leaves its row out', async () => {
        const l = { ...row(401805007), spread_home_open: -2.5 };
        const t = lines(await page(gameAs(401805007, { name: 'STATUS_IN_PROGRESS', completed: false, period: 3, displayClock: '6:37' }, [40, 35]), l));
        expect(t).toContain('Open Latest');
        expect(t).toContain('Spread WKU -2.5 WKU -3.5');
        expect(t).not.toContain('Total');
        expect(t).toContain('Latest is the last nightly quote.');
        expect(t).not.toContain('covered');
    });
    test('live: at this pace against the line', async () => {
        const t = lines(await page(gameAs(401809234, { name: 'STATUS_IN_PROGRESS', completed: false, period: 3, displayClock: '6:37' }, [68, 59]), row(401809234)));
        // 68 and 59 over 1,763 of 2,880 seconds: 111 and 96, a total of 207
        expect(t).toContain('At this pace: CLE 96, NY 111; a total of 207, under 229; NY on pace to cover CLE -1.5');
        expect(t).not.toContain('Upset');
        // overtime: no pace
        expect(lines(await page(gameAs(401809234, { name: 'STATUS_IN_PROGRESS', completed: false, period: 5, displayClock: '2:00' }, [110, 110]), row(401809234)))).not.toContain('At this pace');
    });
    test('an open-only row (the current season) shows the open alone', async () => {
        const t = lines(await page(gameAs(401809234, { name: 'STATUS_SCHEDULED', completed: false }, [0, 0]), row(401909088)));
        expect(t).toContain('Open');
        expect(t).not.toContain('Latest');
        expect(t).not.toContain('Consensus');
    });
    test('a failed read says so', async () => {
        const html = await page(gameAs(401809234), null);
        expect(html).toContain('id="lines-unavailable"');
        expect(html).not.toContain('id="lines-body"');
    });
});

describe('NbaPreGamePage', () => {
    const espnGame = { gameId: 401909088, gamepackageJSON: { header: { season: { year: 2027 }, competitions: [{ date: '2026-10-22T01:00Z', status: { type: { name: 'STATUS_SCHEDULED', completed: false, description: 'Scheduled' } }, broadcasts: [], competitors: [
        { homeAway: 'home', team: { id: '19', abbreviation: 'ORL', location: 'Orlando', name: 'Magic', displayName: 'Orlando Magic' } },
        { homeAway: 'away', team: { id: '1', abbreviation: 'ATL', location: 'Atlanta', name: 'Hawks', displayName: 'Atlanta Hawks' } }] }] } } };
    const render = (flagOverrides: Record<string, boolean> = {}) => container.renderToString(NbaPreGamePage, { props: { espnGame }, locals: { league: 'nba', preview: true, flagOverrides } as App.Locals });
    beforeEach(() => { api.calls = []; api.rows = []; api.fail = false; });
    test('the latest quote, with no score, prior or pace; no row or flag off, no section', async () => {
        api.rows = [row(401909088)];
        const html = await render();
        expect(api.calls.map((c) => c.query)).toEqual([{ season: '2027', game_id: '401909088', limit: '2' }]);
        const t = lines(html);
        expect(t).toContain('Spread ORL -1.5 Total 221.5 Moneyline ATL +105 Moneyline ORL -125');
        expect(t).toContain('Market pregame: ORL 53%');
        for (const gone of ['prior', 'pace', 'covered', 'Consensus']) expect(t).not.toContain(gone);
        api.rows = [];
        expect(await render()).not.toContain('id="lines"');
        api.calls = [];
        expect(await render({ 'bball-lines': false })).not.toContain('id="lines"');
        expect(api.calls).toEqual([]);
        api.fail = true;
        expect(await render()).toContain('id="lines-unavailable"');
    });
});
