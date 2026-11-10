// BB-G39: the game page's shooting signature and FG% distance bars beside each team's shot chart, behind
// 'bball-game-shooting'. The game's shots binned as the league's (sdv-db's rounded shot_distance), the route's one read,
// and the page in all four leagues: real ingested finals (fixtures/<league>/game_*_api.json) against the real
// shot_league_context rows (fixtures/<league>/dashboards/league_context_2026.json; the NBA's from league_context.json's
// curves). Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const ctxFn = vi.hoisted(() => ({ fn: (async () => []) as (...a: unknown[]) => Promise<unknown[]> }));
vi.mock('../src/resources/nbaShots', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaShots')>()), retrieveLeagueContextRows: (...a: unknown[]) => ctxFn.fn(...a) }));
const sched = vi.fn(), rows = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a) }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { leagueContextFromRows } from '../src/nba/adapters';
import { gameShotsLite, shotFeet, type GameShot } from '../src/nba/charts/gameShotChart';
import { distanceCharts, type LeagueContext } from '../src/nba/dashboard';
import { shotsOf, unlocatedShots } from '../src/nba/data/game';
import type { LeagueContextRow } from '../src/resources/nbaShots';
import { fromDataApi, type NbaGame } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { placeholderFor } from '../src/basketball/config';
import type { BasketballLeague } from '../src/utils/league';

const json = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)).toString());
const GAMES: Record<BasketballLeague, string> = { nba: '401766458', wnba: '401736287', mbb: '401820775', wbb: '401805076' };
const gameApi = (league: BasketballLeague) => json(`${league}/game_${GAMES[league]}_api.json`);
const game = (league: BasketballLeague): NbaGame => fromDataApi(gameApi(league), league);

/** The NBA fixture is a LeagueContext (curves only), so its rows are rebuilt from its own byFoot / byBin. */
function nbaRows(): LeagueContextRow[] {
    const c = json('nba/league_context.json');
    const row = (kind: string, key1: number | null, attempts: number, makes: number): LeagueContextRow => ({ season: 2026, kind, key1, key2: null, attempts, makes, fg3a: 0, fg3m: 0 });
    return [
        ...c.byFoot.map((b: any) => row('distance_1ft', b.distance, b.attempts, b.makes)),
        ...c.byBin.map((b: any, i: number) => row('distance_3ft', i, b.attempts, b.makes)),
        row('total', null, c.byFoot.reduce((n: number, b: any) => n + b.attempts, 0), c.byFoot.reduce((n: number, b: any) => n + b.makes, 0)),
    ];
}
const contextRows = (league: BasketballLeague): LeagueContextRow[] => (league === 'nba' ? nbaRows() : json(`${league}/dashboards/league_context_2026.json`));
const context = (league: BasketballLeague): LeagueContext => leagueContextFromRows(contextRows(league));

/** The page's own conversion (NbaGameShotCharts.astro): one team's plays as the chart's shots. */
function teamShots(g: NbaGame, teamId: string, league: BasketballLeague): GameShot[] {
    const plays = shotsOf(g.plays, Number(teamId));
    const un = league === 'mbb' || league === 'wbb' ? unlocatedShots(plays) : new Set();
    return plays.map((p) => ({ x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || 2, label: p.text, period: p.period, ...(un.has(p) ? { unlocated: true as const } : {}) }));
}

describe('the game\'s shots binned like the league\'s', () => {
    test('shotFeet is sdv-db\'s shot_distance (floor(hypot / 10 + 0.5)) on the real college shot rows', () => {
        const shots = json('mbb/dashboards/tex_shots_2026.json') as any[];
        const located = shots.filter((s) => s.x_legacy != null);
        expect(located.length).toBeGreaterThan(500);
        for (const s of located) expect(shotFeet({ x: s.x_legacy, y: s.y_legacy })).toBe(s.shot_distance);
    });
    test('gameShotsLite drops an unlocated shot and keeps made, value and the rounded feet', () => {
        const lite = gameShotsLite([
            { x: 0, y: 0, made: true, value: 2, label: '', period: 1, unlocated: true },
            { x: 30, y: 40, made: false, value: 2, label: '', period: 1 },
            { x: -220, y: 15, made: true, value: 3, label: '', period: 2 },
        ], 'g1');
        expect(lite).toEqual([
            { game_id: 'g1', x_legacy: 30, y_legacy: 40, shot_distance: 5, shot_value: 2, shot_result: 'Missed' },
            { game_id: 'g1', x_legacy: -220, y_legacy: 15, shot_distance: 22, shot_value: 3, shot_result: 'Made' },
        ]);
    });
    test('the WNBA through 2010: shots at the placeholder location (the rim, D29) enter no bar, as in the league curve', () => {
        const g = fromDataApi(json('wnba/game_250603003_api.json'), 'wnba'); // 2005, 33 of 114 attempts at the placeholder
        const shots = [g.away, g.home].flatMap((s) => teamShots(g, s.team.id, 'wnba'));
        const atRim = shots.filter((s) => s.x === 0 && s.y === 0).length;
        expect(atRim).toBe(33);
        expect(gameShotsLite(shots, g.id, placeholderFor('wnba', 2005))).toHaveLength(shots.length - atRim);
        expect(gameShotsLite(shots, g.id, placeholderFor('wnba', 2026))).toHaveLength(shots.length);
    });
    for (const league of ['nba', 'wnba', 'mbb', 'wbb'] as const) {
        test(`${league}: every located shot inside 35 ft lands in one bar and one signature foot, against the league's curves`, () => {
            const g = game(league), ctx = context(league);
            for (const side of [g.away, g.home]) {
                const lite = gameShotsLite(teamShots(g, side.team.id, league), g.id);
                expect(lite.length, `${league} ${side.team.abbreviation}`).toBeGreaterThan(20);
                const { signature, bars } = distanceCharts(lite, ctx);
                const inside = lite.filter((s) => s.shot_distance <= 35);
                expect(bars.player.reduce((n, b) => n + b.attempts, 0)).toBe(inside.length);
                expect(bars.player.reduce((n, b) => n + b.makes, 0)).toBe(inside.filter((s) => s.shot_result === 'Made').length);
                expect(signature).toHaveLength(36);
                expect(bars.league).toBe(ctx.byBin);
                expect(ctx.fgPct).toBeGreaterThan(0.3);
            }
        });
    }
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: GAMES.nba }, url: new URL(`https://gameonpaper.com/nba/game/${GAMES.nba}`), locals: { ...locals, flagOverrides: { 'bball-impact-box': false, 'bball-game-flow': false, ...(locals.flagOverrides as object) } }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareBasketballGame', () => {
    const ingested = () => { sched.mockResolvedValueOnce(gameApi('nba').schedule[0]); rows.mockResolvedValueOnce(gameApi('nba')); };
    let fn = vi.fn();
    beforeEach(() => { [sched, rows].forEach((f) => f.mockReset()); fn = vi.fn(async () => nbaRows()); ctxFn.fn = fn; });
    test("'bball-game-shooting' is a preview flag", () => { expect(FLAGS['bball-game-shooting']).toBe('preview'); });
    test('off: no read and no shooting key', async () => {
        ingested();
        expect('shooting' in (await prepareBasketballGame(fakeAstro({ preview: true, flagOverrides: { 'bball-game-shooting': false } }).astro, 'nba'))).toBe(false);
        ingested();
        expect('shooting' in (await prepareBasketballGame(fakeAstro({}).astro, 'nba'))).toBe(false); // no preview cookie
        expect(fn).not.toHaveBeenCalled();
    });
    test('on, an ingested final: one read by the game\'s season, the year-long cache kept', async () => {
        ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(2025, 'nba');
        expect('shooting' in r && r.shooting?.fgPct).toBeCloseTo(0.445, 3);
        expect((cache.at(-1) as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });
    test('on, a season with no league curve yet: shooting without fgPct, held for the season window', async () => {
        ctxFn.fn = async () => []; ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('shooting' in r && r.shooting?.fgPct).toBeNull();
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, a failed read: shooting null, the page renders, nothing is cached', async () => {
        ctxFn.fn = async () => { throw new Error('down'); }; ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.shooting).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const page = async (league: BasketballLeague, g: NbaGame, shooting?: LeagueContext | null) =>
    normalize(await container.renderToString(NbaGamePage, { props: { game: g, ...(shooting !== undefined ? { shooting } : {}) }, locals: { league } as App.Locals }));

describe('NbaGamePage', () => {
    test('no league curve (absent, a failed read, an empty season): the shot charts alone, byte for byte', async () => {
        const g = game('nba');
        const off = await page('nba', g);
        expect(await page('nba', g, null)).toBe(off);
        expect(await page('nba', g, leagueContextFromRows([]))).toBe(off);
        expect(off).not.toContain('data-shot-link');
    });
    for (const league of ['nba', 'wnba', 'mbb', 'wbb'] as const) {
        test(`${league}: each team's signature and pinnable FG% bars share one linked dashboard with its shot chart`, async () => {
            const g = game(league);
            const html = await page(league, g, context(league));
            const shots = html.split('id="shots"')[1].split('id="plays"')[0];
            expect(shots.match(/<div data-shot-link>/g)).toHaveLength(2);
            for (const part of shots.split('<div data-shot-link>').slice(1)) {
                expect(part.indexOf('GameShotChart.svelte')).toBeLessThan(part.indexOf('ShootingSignature.svelte'));
                expect(part).toContain('DistanceBars.svelte');
                expect(part).toContain('&quot;pinnable&quot;:[0,true]');
                expect(part).toContain('&quot;metric&quot;:[0,&quot;fgPct&quot;]');
            }
            expect(shots).toContain(league === 'mbb' || league === 'wbb' ? 'regular season + postseason.' : 'regular season.');
            expect(shots).not.toContain('NaN');
            // outside the panel the page is the flag-off page
            const off = await page(league, g);
            expect(html.split('id="shots"')[0]).toBe(off.split('id="shots"')[0]);
            expect(html.split('id="plays"')[1]).toBe(off.split('id="plays"')[1]);
        });
    }
});
