import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ProcessorError } from '../../src/resources/python';

const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../../src/resources/nbaGames', () => ({ retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));
const pushed: any[] = [];
let store: any;
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), gopStorage: { getStore: () => store } }));

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const api = () => read('game_401766458_api');
const procJson = () => read('game_401766458_processor');
function fakeAstro(id: string) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com/nba/game/${id}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const espnPage = (name: string, completed: boolean, regressed = false) => ({ page: { gameId: 401766458, gamepackageJSON: { header: { competitions: [{ date: '2025-04-15T23:30Z', status: { type: { name, completed } }, competitors: [] }] } } }, regressed, reason: 'older' });

beforeEach(() => { [sched, rows, proc, espn].forEach((f) => f.mockReset()); pushed.length = 0; store = { events: pushed, render_outcome: 'ok' }; });

describe('prepareNbaGame', () => {
    test('an ingested final renders from the Data API with no ESPN call at all', async () => {
        sched.mockResolvedValueOnce(api().schedule[0]); rows.mockResolvedValueOnce(api());
        espn.mockRejectedValue(new Error('cdn down'));
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        const r = await prepareNbaGame(astro);
        expect('game' in r && r.game.source === 'data_api').toBe(true);
        expect(espn).not.toHaveBeenCalled(); expect(proc).not.toHaveBeenCalled();
        expect((cache[0] as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
        expect((cache[0] as any).tags).toContain('nba');
    });
    test('a truncated pbp falls through to the processor, logs degraded, and is not cached for a year', async () => {
        const bad = api(); bad.pbp = bad.pbp.slice(0, 100);
        sched.mockResolvedValueOnce(bad.schedule[0]); rows.mockResolvedValueOnce(bad);
        espn.mockResolvedValueOnce(espnPage('STATUS_FINAL', true)); proc.mockResolvedValueOnce(procJson());
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache, headers } = fakeAstro('401766458');
        const r = await prepareNbaGame(astro);
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(pushed.some((e) => e.table === 'error_log' && /sanity gate/.test(e.row.message))).toBe(true);
        expect(store.render_outcome).toBe('degraded');
        expect(cache).toEqual([false]); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a last-play score far from the final also falls through', async () => {
        const bad = api(); bad.pbp[bad.pbp.length - 1] = { ...bad.pbp[bad.pbp.length - 1], home_score: 90 };
        sched.mockResolvedValueOnce(bad.schedule[0]); rows.mockResolvedValueOnce(bad);
        espn.mockResolvedValueOnce(espnPage('STATUS_FINAL', true)); proc.mockResolvedValueOnce(procJson());
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const r = await prepareNbaGame(fakeAstro('401766458').astro);
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(store.render_outcome).toBe('degraded');
    });
    test('a processor-served final is cached one day with the nba tag', async () => {
        sched.mockRejectedValueOnce(new Error('503'));
        espn.mockResolvedValueOnce(espnPage('STATUS_FINAL', true)); proc.mockResolvedValueOnce(procJson());
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        const r = await prepareNbaGame(astro);
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect((cache[0] as any).maxAge).toBe(86400); expect((cache[0] as any).tags).toContain('nba');
    });
    test('a scheduled game is the pregame state', async () => {
        sched.mockResolvedValueOnce({ ...api().schedule[0], status_type_completed: false, status_type_name: 'STATUS_SCHEDULED' });
        espn.mockResolvedValueOnce(espnPage('STATUS_SCHEDULED', false));
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        const r = await prepareNbaGame(astro);
        expect('pregame' in r).toBe(true); expect(proc).not.toHaveBeenCalled(); expect(rows).not.toHaveBeenCalled();
        expect((cache[0] as any).tags).toContain('nba');
    });
    test('a live game goes to the processor on the NBA refresh rate, not the football SEASON_MODE', async () => {
        sched.mockResolvedValueOnce(null);
        espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false)); proc.mockResolvedValueOnce(procJson());
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        const r = await prepareNbaGame(astro);
        expect('game' in r).toBe(true);
        expect(cache[0]).toMatchObject({ maxAge: 60, swr: 120 });
        expect((cache[0] as any).tags).toEqual(expect.arrayContaining(['game-in-progress', 'nba']));
    });
    test('no ESPN page and no Data API row is not found', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: null, regressed: false });
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache, headers } = fakeAstro('401766458');
        expect(await prepareNbaGame(astro)).toEqual({ notFound: true });
        expect(cache).toEqual([false]); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a processor 404 is the pregame state', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false)); proc.mockRejectedValueOnce(new ProcessorError(404, 'no plays'));
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const r = await prepareNbaGame(fakeAstro('401766458').astro);
        expect('pregame' in r).toBe(true);
    });
    test('any other processor failure is unavailable and uncacheable', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false)); proc.mockRejectedValueOnce(new ProcessorError(502, 'bad'));
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache, headers } = fakeAstro('401766458');
        expect(await prepareNbaGame(astro)).toEqual({ unavailable: true });
        expect(cache).toEqual([false]); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a regressed ESPN payload is rendered but logged degraded and never cached', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false, true)); proc.mockResolvedValueOnce(procJson());
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache, headers } = fakeAstro('401766458');
        expect('game' in (await prepareNbaGame(astro))).toBe(true);
        expect(store.render_outcome).toBe('degraded');
        expect(cache).toEqual([false]); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a malformed id is not found with no reads', async () => {
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        for (const id of ['abc', '12', '4017664580000000', "401766458'"]) expect(await prepareNbaGame(fakeAstro(id).astro)).toEqual({ notFound: true });
        expect(sched).not.toHaveBeenCalled(); expect(espn).not.toHaveBeenCalled();
    });
});

describe('fix round 1', () => {
    const proc200 = () => { espn.mockResolvedValueOnce(espnPage('STATUS_FINAL', true)); proc.mockResolvedValueOnce(procJson()); };
    test('a missing middle period falls through even when the last play looks final', async () => {
        const bad = api(); bad.pbp = bad.pbp.filter((p: any) => p.period_number !== 2);
        sched.mockResolvedValueOnce(bad.schedule[0]); rows.mockResolvedValueOnce(bad); proc200();
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const r = await prepareNbaGame(fakeAstro('401766458').astro);
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(pushed.some((e) => /period 2/.test(e.row.message))).toBe(true);
    });
    test('a header-less ESPN page is not found and uncacheable', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: { gameId: 1, gamepackageJSON: {} }, regressed: false });
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        expect(await prepareNbaGame(astro)).toEqual({ notFound: true });
        expect(cache).toEqual([false]);
    });
    test('a gate fall-through is uncacheable even with no telemetry store', async () => {
        store = undefined;
        const bad = api(); bad.pbp = bad.pbp.slice(0, 100);
        sched.mockResolvedValueOnce(bad.schedule[0]); rows.mockResolvedValueOnce(bad); proc200();
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        expect('game' in (await prepareNbaGame(astro))).toBe(true);
        expect(cache).toEqual([false]);
    });
    test('an adapter throw falls through with a degraded row and no year-long cache', async () => {
        const mod = await import('../../src/resources/nbaGame');
        const spy = vi.spyOn(mod, 'fromDataApi').mockImplementationOnce(() => { throw new Error('boom'); });
        sched.mockResolvedValueOnce(api().schedule[0]); rows.mockResolvedValueOnce(api()); proc200();
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        const r = await prepareNbaGame(astro);
        spy.mockRestore();
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(pushed.some((e) => /adapter: boom/.test(e.row.message))).toBe(true);
        expect(cache).toEqual([false]);
    });
    test('rows rejecting on a completed schedule row falls through to the processor', async () => {
        sched.mockResolvedValueOnce(api().schedule[0]); rows.mockRejectedValueOnce(new Error('503')); proc200();
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        expect('game' in (await prepareNbaGame(fakeAstro('401766458').astro))).toBe(true);
    });
    test('the processor-404 pregame path carries the cache policy; a regressed pregame is uncacheable', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false)); proc.mockRejectedValueOnce(new ProcessorError(404, 'x'));
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        let t = fakeAstro('401766458');
        await prepareNbaGame(t.astro);
        expect(t.cache[0]).toMatchObject({ maxAge: 60, swr: 120 });
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(espnPage('STATUS_SCHEDULED', false, true));
        t = fakeAstro('401766458');
        expect('pregame' in (await prepareNbaGame(t.astro))).toBe(true);
        expect(t.cache).toEqual([false]);
    });
});

describe('final review', () => {
    test('a processor 404 on a game ESPN calls final is unavailable, never a cached pregame', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(espnPage('STATUS_FINAL', true)); proc.mockRejectedValueOnce(new ProcessorError(404, 'KeyError'));
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache, headers } = fakeAstro('401766458');
        expect(await prepareNbaGame(astro)).toEqual({ unavailable: true });
        expect(cache).toEqual([false]); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a live payload served after ESPN calls the game final is rendered but not cached', async () => {
        const live = procJson(); live.status = { ...live.status, completed: false, name: 'STATUS_IN_PROGRESS' };
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(espnPage('STATUS_FINAL', true)); proc.mockResolvedValueOnce(live);
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        expect('game' in (await prepareNbaGame(astro))).toBe(true);
        expect(cache).toEqual([false]);
    });
    test('a failed rows read on an ingested final is logged degraded and the fall-through is not cached', async () => {
        sched.mockResolvedValueOnce(api().schedule[0]); rows.mockRejectedValueOnce(new Error('timeout'));
        espn.mockResolvedValueOnce(espnPage('STATUS_FINAL', true)); proc.mockResolvedValueOnce(procJson());
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        expect('game' in (await prepareNbaGame(astro))).toBe(true);
        expect(pushed.some((e) => /rows read failed: timeout/.test(e.row.message))).toBe(true);
        expect(store.render_outcome).toBe('degraded');
        expect(cache).toEqual([false]);
    });
    test('a stringified "True" completed flag still takes the Data API path, read as completed', async () => {
        const s = api(); s.schedule[0] = { ...s.schedule[0], status_type_completed: 'True' };
        sched.mockResolvedValueOnce(s.schedule[0]); rows.mockResolvedValueOnce(s);
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const r = await prepareNbaGame(fakeAstro('401766458').astro);
        expect('game' in r && r.game.source === 'data_api' && r.game.status.completed).toBe(true);
        expect(espn).not.toHaveBeenCalled();
    });
    test('an ESPN outage is unavailable, not a 404', async () => {
        // what the guard really returns on a failed fetch with an empty KV: it never throws
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: null, regressed: false, reason: null, fetchFailed: true });
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        expect(await prepareNbaGame(astro)).toEqual({ unavailable: true });
        expect(cache).toEqual([false]);
    });
    test("an outage served from KV's last copy is rendered, logged degraded, and not cached", async () => {
        sched.mockResolvedValueOnce(null);
        espn.mockResolvedValueOnce({ ...espnPage('STATUS_IN_PROGRESS', false), reason: 'pulled cached content due to ESPN fetch error', fetchFailed: true });
        proc.mockResolvedValueOnce(procJson());
        const { prepareNbaGame } = await import('../../src/routes/nba/game');
        const { astro, cache } = fakeAstro('401766458');
        expect('game' in (await prepareNbaGame(astro))).toBe(true);
        expect(store.render_outcome).toBe('degraded');
        expect(cache).toEqual([false]);
    });
});

describe('sanityGate', () => {
    test('each clause fails on its own; a late-logged free throw does not', async () => {
        const { sanityGate } = await import('../../src/routes/nba/game');
        expect(sanityGate(api(), 'nba')).toBeNull(); // the fixture pbp ends 119-95 against a 120-95 final
        const a = api(); a.pbp = a.pbp.filter((p: any) => p.period_number !== 4); expect(sanityGate(a, 'nba')).toMatch(/period/);
        const np = api(); np.pbp[np.pbp.length - 1] = { ...np.pbp[np.pbp.length - 1], period_number: 'x' }; expect(sanityGate(np, 'nba')).toMatch(/period/);
        const b = api(); b.pbp[b.pbp.length - 1] = { ...b.pbp[b.pbp.length - 1], home_score: 1 }; expect(sanityGate(b, 'nba')).toMatch(/final score/);
        const c = api(); c.team_box = c.team_box.slice(0, 1); expect(sanityGate(c, 'nba')).toMatch(/team_box/);
        const d = api(); d.player_box = d.player_box.slice(0, 4); expect(sanityGate(d, 'nba')).toMatch(/player_box/);
        const e = api(); e.play_wp = e.play_wp.slice(1); expect(sanityGate(e, 'nba')).toMatch(/play_wp/);
        const f = api(); f.game_team_rates = []; expect(sanityGate(f, 'nba')).toMatch(/game_team_rates/);
        const h = api(); h.pbp[h.pbp.length - 1] = { ...h.pbp[h.pbp.length - 1], home_score: 'x' }; expect(sanityGate(h, 'nba')).toMatch(/final score/);
        const g = api(); g.game_player_rates = g.game_player_rates.slice(1); expect(sanityGate(g, 'nba')).toMatch(/game_player_rates/);
    });
});
