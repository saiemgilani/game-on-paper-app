// astro/test/basketball/hubTonight.test.ts
// BB-G48's "Tonight" on the league hub, behind 'bball-hub-tonight' (on top of 'bball-hub'): the night's standouts by game score
// and a win-probability sparkline on each final card. Real ESPN scoreboard captures with the real player_box and play_wp rows
// of those days (fixtures/README.md); the Data API is a mocked retrieveRowsFrom and fetch fails the file on any network call.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { gameScore, sparkline, standouts } from '../../src/basketball/hub';
import { MAX_LINE_READS } from '../../src/resources/gameLines';
import type { BasketballLeague } from '../../src/utils/league';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (u: unknown) => { fetched.push(String(u)); throw new Error(`network: ${String(u)}`); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const fix = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url));
const LINES = JSON.parse(fix('hub-game-lines.json').toString()) as Record<string, any[]>;
const BOARDS: Record<BasketballLeague, string> = {
    nba: 'nba/scoreboard-20250115.json', wnba: 'wnba/scoreboard-20250801.json', mbb: 'mbb/scoreboard-20250222-top25.json', wbb: 'wbb/scoreboard-20260207-top25.json',
};
const events = (lg: BasketballLeague) => JSON.parse(fix(BOARDS[lg]).toString()).content.sbData.events as any[];
const DAYS: Record<BasketballLeague, string> = { nba: '2025-01-15', wnba: '2025-08-01', mbb: '2025-02-22', wbb: '2026-02-07' };
/** `<league>:<game_date>` -> that day's real player_box read (top 200 scorers); ESPN game id -> its real play_wp home WP by play */
const BOX = JSON.parse(gunzipSync(fix('hub-standouts-box.json.gz')).toString()) as Record<string, any[]>;
const WP = JSON.parse(gunzipSync(fix('hub-play-wp.json.gz')).toString()) as Record<string, number[]>;
const finals = (lg: BasketballLeague) => events(lg).filter((e) => e.competitions[0].status.type.completed);
const LEAGUES = ['nba', 'wnba', 'mbb', 'wbb'] as const;

const sb = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), getScoreboardForDay: (...a: unknown[]) => sb(...a) }));
const rows = vi.fn();
vi.mock('../../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../../src/resources/sdv')>()), retrieveRowsFrom: (...a: unknown[]) => rows(...a) }));
/** The hub's own reads, answered from the fixtures. */
const dataFrom = (lg: string) => async (_src: unknown, table: string, q: Record<string, string>) => {
    if (table === 'game_lines') return LINES[lg].filter((r) => String(r.game_id) === q.game_id);
    if (table === 'player_box') return BOX[`${lg}:${q.game_date}`] ?? [];
    if (table === 'play_wp') return (WP[q.game_id] ?? []).map((home_win_prob, i) => ({ game_play_number: i + 1, home_win_prob }));
    throw new Error(`unexpected read ${table}`);
};
const teams = vi.fn(async () => ({ unavailable: true }));
vi.mock('../../src/routes/basketball/teams', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/teams')>()), prepareBasketballTeams: (...a: unknown[]) => teams(...a) }));
beforeEach(() => { sb.mockReset(); rows.mockReset(); teams.mockClear(); });
const reads = (table: string) => rows.mock.calls.filter((c) => c[1] === table).map((c) => c[2] as Record<string, string>);
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '');

/** As the NBA byte-identity test: the checkout root (island component-urls), island uids and scoped-style ids are host bytes. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T16:00:00Z')); // the scoreboard's off-day check reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
const render = async (lg: BasketballLeague, locals: Partial<App.Locals> = { preview: true }) => {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/${lg}/index.astro`);
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/${lg}`), locals: locals as App.Locals });
};

describe("flag off: BB-G47's hub, byte for byte, and no new read", () => {
    for (const lg of LEAGUES) {
        test(lg, async () => {
            sb.mockResolvedValue({ day: DAYS[lg], events: events(lg), degraded: false });
            rows.mockImplementation(dataFrom(lg));
            const html = await render(lg, { preview: true, flagOverrides: { 'bball-hub-tonight': false } });
            // the snapshots were written by BB-G47's code (feat/basketball-league-hub at fb2bbed3), before this change
            await expect(normalize(html)).toMatchFileSnapshot(`./__hub_byte_identity__/${lg}.html`);
            expect(new Set(rows.mock.calls.map((c) => c[1]))).toEqual(new Set(['game_lines']));
        });
    }
});

describe('gameScore, standouts and sparkline', () => {
    const night = BOX['nba:2025-01-15'];
    test("game score of a real line: Brunson's 38 (14-22 FG, 7-9 FT, 1+4 REB, 4 AST, 2 STL, 5 TO, 1 PF)", () => {
        const r = night.find((x) => x.athlete_display_name === 'Jalen Brunson')!;
        expect(gameScore(r)).toBeCloseTo(28.7, 10);
    });
    test('the five best by game score, best first; a DNP never counts; every one names its game', () => {
        const top = standouts(night);
        expect(top).toHaveLength(5);
        for (let i = 1; i < top.length; i++) expect(top[i - 1].gameScore).toBeGreaterThanOrEqual(top[i].gameScore);
        const best = Math.max(...night.map(gameScore));
        expect(top[0].gameScore).toBe(Math.round(best * 10) / 10);
        for (const s of top) expect(night.some((r) => String(r.game_id) === s.gameId && r.athlete_display_name === s.name), s.name).toBe(true);
        // the WNBA day's read carries 24 zero-minute rows
        const w = BOX['wnba:2025-08-01'];
        const dnp = new Set(w.filter((r) => !(Number(r.minutes) > 0)).map((r) => r.athlete_display_name));
        expect(dnp.size).toBeGreaterThan(0);
        expect(standouts(w, 200).some((s) => dnp.has(s.name))).toBe(false);
        expect(standouts([])).toEqual([]);
    });
    test('sparkline: the whole game left to right, home WP up, at most 81 points; nothing under two plays', () => {
        const wp = WP[finals('nba')[0].id];
        expect(wp.length).toBeGreaterThan(300);
        const pts = sparkline(wp)!.split(' ').map((p) => p.split(',').map(Number));
        expect(pts.length).toBeLessThanOrEqual(81);
        expect(pts[0][0]).toBe(0);
        expect(pts.at(-1)![0]).toBe(100);
        expect(pts.at(-1)![1]).toBeCloseTo((1 - wp.at(-1)!) * 24, 1);
        for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(24); }
        expect(sparkline([0.5])).toBeNull();
        expect(sparkline([null, 0.5, Number.NaN])).toBeNull();
        expect(sparkline([0.5, 1])).toBe('0.0,12.0 100.0,0.0');
    });
});

describe('/<league> behind bball-hub-tonight', () => {
    for (const lg of LEAGUES) {
        test(`${lg}: the day's standouts linked to their games, and a sparkline on every final card`, async () => {
            sb.mockResolvedValue({ day: DAYS[lg], events: events(lg), degraded: false });
            rows.mockImplementation(dataFrom(lg));
            const html = await render(lg);
            // one standouts read, of the board's own day, by the season of its games
            expect(reads('player_box')).toEqual([expect.objectContaining({ season: String(events(lg)[0].season.year), game_date: DAYS[lg], order: '-points', limit: '200' })]);
            expect(reads('play_wp').map((q) => q.game_id).sort()).toEqual(finals(lg).map((e) => e.id).sort());
            const top = standouts(BOX[`${lg}:${DAYS[lg]}`]);
            expect(top).toHaveLength(5);
            expect((html.match(/data-hub-standout=/g) ?? []).length).toBe(5);
            for (const s of top) expect(html).toContain(`data-hub-standout="${s.gameId}"><a href="/${lg}/game/${s.gameId}"`);
            for (const e of finals(lg)) expect(html, e.id).toContain(`data-hub-wp="${e.id}"`);
            expect(html.indexOf('id="hub-games"')).toBeLessThan(html.indexOf('id="hub-standouts"'));
            expect(html.indexOf('id="hub-standouts"')).toBeLessThan(html.indexOf('id="hub-index"'));
            for (const bad of ['NaN', 'undefined', 'null']) expect(noScripts(html)).not.toContain(bad);
        });
    }
    test('no final on the board yet (tonight before tip): the night before, and no play_wp read', async () => {
        const pre = events('nba').map((e) => ({ ...e, competitions: [{ ...e.competitions[0], status: { ...e.competitions[0].status, type: { ...e.competitions[0].status.type, state: 'pre', name: 'STATUS_SCHEDULED', completed: false } } }] }));
        sb.mockResolvedValue({ day: '2025-01-15', events: pre, degraded: false });
        rows.mockImplementation(dataFrom('nba'));
        const html = await render('nba');
        expect(reads('player_box').map((q) => q.game_date)).toEqual(['2025-01-14']);
        expect(reads('play_wp')).toEqual([]);
        expect(html).toContain('The best individual games of Tuesday, January 14, by game score.');
        expect(html).not.toContain('data-hub-wp=');
    });
    test("finals the nightly has not ingested: the night before's standouts, no sparklines", async () => {
        sb.mockResolvedValue({ day: '2025-01-15', events: events('nba'), degraded: false });
        rows.mockImplementation(async (src: unknown, table: string, q: Record<string, string>) =>
            (table === 'play_wp' || (table === 'player_box' && q.game_date === '2025-01-15') ? [] : dataFrom('nba')(src, table, q)));
        const html = await render('nba');
        expect(reads('player_box').map((q) => q.game_date)).toEqual(['2025-01-15', '2025-01-14']);
        expect(html).toContain('Tuesday, January 14');
        expect(html).not.toContain('data-hub-wp=');
    });
    test('failed reads: no standouts section and no sparklines, the hub still renders', async () => {
        sb.mockResolvedValue({ day: DAYS.mbb, events: events('mbb'), degraded: false });
        rows.mockImplementation(async (src: unknown, table: string, q: Record<string, string>) => { if (table !== 'game_lines') throw new Error('503'); return dataFrom('mbb')(src, table, q); });
        const html = await render('mbb');
        expect(html).not.toContain('id="hub-standouts"');
        expect(html).not.toContain('data-hub-wp=');
        expect(html).toContain('id="hub-final"');
        expect(html).toContain('id="hub-index"');
    });
    test('a degraded board makes no "Tonight" read', async () => {
        sb.mockResolvedValue({ day: '2026-11-10', events: [], degraded: true });
        rows.mockImplementation(dataFrom('wbb'));
        const html = await render('wbb');
        expect(rows).not.toHaveBeenCalled();
        expect(html).not.toContain('id="hub-standouts"');
    });
    test(`an all-D-I day reads play_wp for its first ${MAX_LINE_READS} finals only`, async () => {
        const all = JSON.parse(gunzipSync(fix('mbb/scoreboard-20241104-all.json.gz')).toString()).content.sbData.events as any[];
        const done = all.filter((e) => e.competitions[0].status.type.completed);
        expect(done.length).toBeGreaterThan(MAX_LINE_READS);
        sb.mockResolvedValue({ day: '2024-11-04', events: all, degraded: false });
        rows.mockResolvedValue([]);
        await render('mbb');
        expect(reads('play_wp')).toHaveLength(MAX_LINE_READS);
    });
    test("'bball-hub-tonight' alone does nothing: with 'bball-hub' off the landing is today's and nothing is read", async () => {
        await render('wnba', { preview: true, flagOverrides: { 'bball-hub': false, 'bball-hub-tonight': true } });
        expect(teams).toHaveBeenCalledTimes(1);
        expect(sb).not.toHaveBeenCalled();
        expect(rows).not.toHaveBeenCalled();
    });
});
