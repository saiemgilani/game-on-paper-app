// BB-G45: the WP lenses, the margin overlay and the game-flow extras behind 'bball-wp-lenses'. Two real 2025 NBA finals
// (fixtures/README.md: wp-lenses-nba-*.json.gz): one with a closing line (both variants) and one without (naive only). The
// extras are checked against the rows themselves, the read's query and TTL, the route's gate and cache, and the WP panel:
// lenses shown, a missing variant hidden, and the flag-off panel byte for byte. Every Data API read here is mocked.
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

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string>; ttl: unknown }[], rows: [] as any[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>, ttl: unknown) => {
        api.calls.push({ schema: source.schema, table, query, ttl });
        if (api.fail) throw new Error('down');
        if (table === 'play_wp') return api.rows;
        throw new Error(`unexpected table ${table}`);
    },
}));
const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaWinProbability from '../src/components/nba/game/NbaWinProbability.astro';
import { fromDataApi, type DataApiGameRows, type NbaGame } from '../src/resources/nbaGame';
import { retrieveWpLenses } from '../src/resources/wpLenses';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { seasonCache } from '../src/routes/basketball/cache';
import { FLAGS } from '../src/utils/features';
import { clockSeconds } from '../src/utils/gameFlow';
import { chartPlays, flowExtras, momentText, moments, stampAt, stretchText, wpLenses, type WpLensRow } from '../src/utils/wpLenses';

const fx = (id: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/wp-lenses-nba-${id}.json.gz`, import.meta.url))).toString()) as DataApiGameRows;
const LINE = '401704939'; // CHA 98 at PHI 108, PHI -13 at the close
const NOLINE = '401704690'; // BKN 119 at MEM 106, no game_lines row
const variants = (r: DataApiGameRows): WpLensRow[] => r.play_wp.map((w) => ({ n: w.game_play_number, naive: w.home_win_prob_naive, market: w.home_win_prob_market }));
const game = (id: string, withLenses = true): NbaGame => { const r = fx(id); return { ...fromDataApi(r, 'nba'), ...(withLenses ? { wpLenses: variants(r) } : {}) }; };

describe('the lenses', () => {
    test('a game with a line: our model, score and clock only, market prior, each on every charted play', () => {
        const g = game(LINE);
        const l = wpLenses(chartPlays(g), g.wpLenses)!;
        expect(l.map((x) => x.key)).toEqual(['model', 'naive', 'market']);
        const r = fx(LINE);
        for (const x of l) expect(x.values).toHaveLength(r.play_wp.length);
        expect(l[0].values[0]).toBe(r.play_wp[0].home_win_prob);
        // the home side is favoured: the market prior starts it above the 50% one
        expect(l[2].values[0]).toBeGreaterThan(l[1].values[0]);
    });
    test('no line: the market lens is hidden, the naive one stays', () => {
        const g = game(NOLINE);
        expect(wpLenses(chartPlays(g), g.wpLenses)!.map((x) => x.key)).toEqual(['model', 'naive']);
    });
    test('a variant missing on one play is no lens; no variant at all is no switch', () => {
        const g = game(LINE);
        const rows = g.wpLenses!.map((r, i) => (i === 100 ? { ...r, market: null } : r));
        expect(wpLenses(chartPlays(g), rows)!.map((x) => x.key)).toEqual(['model', 'naive']);
        expect(wpLenses(chartPlays(g), rows.map((r) => ({ ...r, naive: null, market: null })))).toBeNull();
        expect(wpLenses(chartPlays(g), [])).toBeNull();
        expect(wpLenses(chartPlays(g), undefined)).toBeNull();
    });
});

describe('the extras agree with the rows', () => {
    const r = fx(LINE);
    const g = game(LINE);
    const x = flowExtras(g, 720);
    const at = (t: number) => stampAt(t, g.periods, g.regulation, 720, g.periodKind);
    test('stamps: a score at the buzzer ends its period', () => {
        expect(at(0)).toBe('Q1 12:00');
        expect(at(720)).toBe('Q1 0:00');
        expect(at(721)).toBe('Q2 11:59');
        expect(at(2880)).toBe('Q4 0:00');
    });
    test('last 5:00: the final minus the score with more than five minutes left', () => {
        const before = r.pbp.filter((p) => p.period_number === 4 && clockSeconds(p.clock_display_value)! > 300).at(-1)!;
        const s = r.schedule[0];
        expect(x.last5).toEqual({ home: s.home_score - before.home_score, away: s.away_score - before.away_score });
        expect(x.last5).toEqual({ home: 10, away: 9 });
    });
    test('runs of 8-0 or better, with their clock stamps', () => {
        expect(x.runs.map((u) => `${u.side} ${u.points}-0 ${at(u.from)} to ${at(u.to)} (${u.away}-${u.home})`)).toEqual([
            'home 10-0 Q2 1:00 to Q3 10:43 (46-64)', 'away 8-0 Q3 7:26 to Q3 6:15 (58-73)', 'away 12-0 Q4 9:57 to Q4 6:56 (85-89)']);
        expect(flowExtras(game(NOLINE), 720).runs.map((u) => `${u.side} ${u.points}`)).toEqual(['away 8']);
    });
    test('the longest drought: no home score in between', () => {
        expect(x.drought && [x.drought.side, x.drought.seconds, at(x.drought.from), at(x.drought.to)]).toEqual(['home', 236, 'Q4 10:37', 'Q4 6:41']);
        const inside = r.pbp.filter((p) => p.period_number === 4 && clockSeconds(p.clock_display_value)! < 637 && clockSeconds(p.clock_display_value)! > 401);
        expect(new Set(inside.map((p) => p.home_score)).size).toBe(1);
    });
    test('peaks and the winner\'s low leave out the settled rows; the swing is the biggest wp_delta', () => {
        const live = r.play_wp.filter((w) => w.home_win_prob > 0 && w.home_win_prob < 1);
        expect(x.peak.home!.wp).toBe(Math.max(...live.map((w) => w.home_win_prob)));
        expect(x.peak.away!.wp).toBe(Math.max(...live.map((w) => 1 - w.home_win_prob)));
        expect(x.comeback!.wp).toBe(Math.min(...live.map((w) => w.home_win_prob))); // PHI won
        expect(x.swing!.n).toBe(361);
        const ng = game(NOLINE), nr = fx(NOLINE);
        const nx = flowExtras(ng, 720);
        expect(nx.comeback!.wp).toBe(Math.min(...nr.play_wp.filter((w) => w.home_win_prob > 0 && w.home_win_prob < 1).map((w) => 1 - w.home_win_prob))); // BKN won away
        expect(nx.comeback!.wp).toBeLessThan(0.2);
    });
    test('a live game: no last 5:00 and no comeback', () => {
        const live = { ...g, status: { ...g.status, completed: false }, home: { ...g.home, winner: false } };
        const lx = flowExtras(live, 720);
        expect(lx.last5).toBeNull();
        expect(lx.comeback).toBeNull();
        expect(lx.peak.home).not.toBeNull();
    });
    test('the readouts', () => {
        const m = moments(chartPlays(g), g.regulation, g.periodKind);
        expect(m).toHaveLength(r.play_wp.length);
        expect(momentText({ at: 'Q3 4:12', a: 66, h: 70 }, 0.612, 'PHI', 'CHA')).toBe('Q3 4:12 · CHA 66-70 PHI · PHI 61.2%');
        expect(momentText({ at: 'Q1 9:00', a: 6, h: 2 }, 0.3, 'PHI', 'CHA')).toBe('Q1 9:00 · CHA 6-2 PHI · CHA 70.0%');
        expect(stretchText({ at: 'Q2 8:14', a: 30, h: 28 }, { at: 'Q3 4:12', a: 40, h: 50 }, 0.45, 0.62, 'PHI', 'CHA'))
            .toBe('Q2 8:14 to Q3 4:12: PHI 45.0% to 62.0% (+17.0 pts); PHI outscored CHA 22-10');
    });
});

describe('the read', () => {
    beforeEach(() => { api.calls.length = 0; api.fail = false; api.rows = []; });
    test('one play_wp read by season and game, the two columns only; a year once built, the nightly window before', async () => {
        api.rows = fx(LINE).play_wp;
        const got = await retrieveWpLenses('nba', 2025, LINE);
        expect(got).toEqual(variants(fx(LINE)));
        expect(api.calls).toHaveLength(1);
        const c = api.calls[0];
        expect([c.schema, c.table]).toEqual(['nba', 'play_wp']);
        expect(c.query).toEqual({ season: '2025', game_id: LINE, select: 'game_play_number,home_win_prob_naive,home_win_prob_market', order: 'game_play_number', limit: '5000' });
        const ttl = c.ttl as (content: unknown) => number;
        expect(ttl({ data: fx(LINE).play_wp })).toBe(60 * 60 * 24 * 365);
        expect(ttl({ data: fx(LINE).play_wp.map((w: any) => ({ ...w, home_win_prob_naive: null, home_win_prob_market: null })) })).toBe(6 * 60 * 60);
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    // the final's other panels off: only this read is under test
    const flagOverrides = { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-garbage-time': false, ...(locals.flagOverrides as object) };
    return { astro: { params: { id: LINE }, url: new URL(`https://gameonpaper.com/nba/game/${LINE}`), locals: { ...locals, flagOverrides }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareBasketballGame', () => {
    const ingested = () => { sched.mockResolvedValueOnce(fx(LINE).schedule[0]); rows.mockResolvedValueOnce(fx(LINE)); };
    beforeEach(() => { [sched, rows, proc, espn].forEach((f) => f.mockReset()); api.calls.length = 0; api.fail = false; api.rows = fx(LINE).play_wp; });
    test("'bball-wp-lenses' is a preview flag", () => { expect(FLAGS['bball-wp-lenses']).toBe('preview'); });
    test('off: no read, no wpLenses, the final keeps its year', async () => {
        for (const locals of [{}, { preview: true, flagOverrides: { 'bball-wp-lenses': false } }]) {
            ingested();
            const f = fakeAstro(locals);
            const r = await prepareBasketballGame(f.astro, 'nba');
            expect('game' in r && 'wpLenses' in r.game).toBe(false);
            expect(f.cache.at(-1)).toMatchObject({ maxAge: 60 * 60 * 24 * 7 * 52 });
        }
        expect(api.calls).toEqual([]);
    });
    test('on: the rows ride on the game, the final keeps its year', async () => {
        ingested();
        const f = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(f.astro, 'nba');
        expect('game' in r && r.game.wpLenses).toEqual(variants(fx(LINE)));
        expect(api.calls.map((c) => c.query.season)).toEqual(['2025']);
        expect(f.cache.at(-1)).toMatchObject({ maxAge: 60 * 60 * 24 * 7 * 52 });
    });
    test('a processor-served game, live or final, spends no read (its plays are not play_wp ingest)', async () => {
        const procJson = () => JSON.parse(readFileSync(new URL('./fixtures/nba/game_401766458_processor.json', import.meta.url)).toString());
        const page = (name: string, completed: boolean) => ({ page: { gameId: 401766458, gamepackageJSON: { header: { competitions: [{ date: '2025-04-15T23:30Z', status: { type: { name, completed } }, competitors: [] }] } } }, regressed: false });
        for (const completed of [false, true]) {
            sched.mockResolvedValueOnce(null);
            espn.mockResolvedValueOnce(page(completed ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS', completed));
            const j = procJson(); if (!completed) j.status = { ...j.status, completed: false, name: 'STATUS_IN_PROGRESS' };
            proc.mockResolvedValueOnce(j);
            const r = await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'nba');
            expect('game' in r && r.game.source).toBe('processor');
            expect('game' in r && 'wpLenses' in r.game).toBe(false);
        }
        expect(api.calls).toEqual([]);
    });
    test('a failed read: no lenses, never cached', async () => {
        ingested();
        api.fail = true;
        const f = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(f.astro, 'nba');
        expect('game' in r && 'wpLenses' in r.game).toBe(false);
        expect(f.cache.at(-1)).toBe(false);
        expect(f.headers.get('Cache-Control')).toBe('no-store');
    });
    test('a season not rebuilt with the variants yet: no lenses, held for the nightly window', async () => {
        ingested();
        api.rows = fx(LINE).play_wp.map((w: any) => ({ ...w, home_win_prob_naive: null, home_win_prob_market: null }));
        const f = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(f.astro, 'nba');
        expect('game' in r && 'wpLenses' in r.game).toBe(false);
        expect(f.cache.at(-1)).toEqual(seasonCache('nba'));
    });
});

describe('the WP panel', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = (g: NbaGame, locals: Record<string, unknown>) => container.renderToString(NbaWinProbability, { props: { game: g, colors: null }, locals: { league: 'nba', ...locals } as App.Locals });
    const island = (html: string) => (html.match(/<astro-island[^>]*WinProbabilityChart[^>]*>/)?.[0] ?? '').replace(/&quot;/g, '"');
    test('on, with a line: three lenses, the margin moments and the extras', async () => {
        const html = await render(game(LINE), { preview: true });
        const p = island(html);
        for (const k of ['model', 'naive', 'market']) expect(p).toContain(`[0,"${k}"]`);
        expect(p).toContain('"moments"');
        expect(html).toContain('id="wp-extras"');
        expect(html).toContain('PHI 10-0, Q2 1:00 to Q3 10:43');
        expect(html).toContain('Lenses: our model starts from the pregame prior; score and clock only');
        expect(html).toContain('market prior starts from');
    });
    test('on, no line: no market lens; no rows at all: no switch, the overlay and extras stay', async () => {
        let p = island(await render(game(NOLINE), { preview: true }));
        expect(p).toContain('[0,"naive"]');
        expect(p).not.toContain('[0,"market"]');
        const html = await render(game(NOLINE, false), { preview: true });
        p = island(html);
        expect(p).not.toContain('"lenses"');
        expect(p).toContain('"moments"');
        expect(html).not.toContain('Lenses:');
        expect(html).toContain('id="wp-extras"');
    });
    test('off: byte for byte the panel without the rows', async () => {
        const off = await render(game(LINE), { preview: true, flagOverrides: { 'bball-wp-lenses': false } });
        expect(off).toBe(await render(game(LINE, false), {}));
        expect(off).not.toContain('wp-extras');
        expect(island(off)).not.toContain('"moments"');
    });
});
