import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ProcessorError } from '../../src/resources/python';

const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../../src/resources/nbaGames', () => ({ retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));
let store: any;
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), gopStorage: { getStore: () => store } }));

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wnba/${name}.json`, import.meta.url)).toString());
const final = () => ({ page: read('espn_page_401736287'), regressed: false, reason: null, fetchFailed: false });
const scheduled = () => ({ page: read('pregame_401918306'), regressed: false, reason: null, fetchFailed: false });
function fakeAstro(id: string) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com/wnba/game/${id}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const load = async () => (await import('../../src/routes/basketball/game')).prepareBasketballGame;

beforeEach(() => { [sched, rows, proc, espn].forEach((f) => f.mockReset()); store = { events: [], render_outcome: 'ok' }; });

describe("prepareBasketballGame(Astro, 'wnba') on real WNBA rows and pages", () => {
    test('an ingested final renders from the wnba Data API, no ESPN call, held a year under the wnba tag', async () => {
        const api = read('game_401736287_api');
        sched.mockResolvedValueOnce(api.schedule[0]); rows.mockResolvedValueOnce(api);
        const { astro, cache } = fakeAstro('401736287');
        const r = await (await load())(astro, 'wnba');
        expect('game' in r && r.game.source === 'data_api').toBe(true);
        expect(astro.locals.league).toBe('wnba');
        expect(sched).toHaveBeenCalledWith('401736287', 'wnba'); expect(rows).toHaveBeenCalledWith('401736287', 'wnba');
        expect(espn).not.toHaveBeenCalled(); expect(proc).not.toHaveBeenCalled();
        expect((cache[0] as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
        expect((cache[0] as any).tags).toEqual(['game-completed', 'wnba']);
    });
    test("a Data API boolean spelled 'True' still means ingested (isTrue)", async () => {
        const api = read('game_250603003_api'); api.schedule[0] = { ...api.schedule[0], status_type_completed: 'True' };
        sched.mockResolvedValueOnce(api.schedule[0]); rows.mockResolvedValueOnce(api);
        const r = await (await load())(fakeAstro('250603003').astro, 'wnba');
        expect('game' in r && r.game.source === 'data_api' && r.game.regulation === 2).toBe(true);
    });
    test('a final the Data API lacks goes to /wnba/<id>/process and is held one day', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(final()); proc.mockResolvedValueOnce(read('game_401736287_processor'));
        const { astro, cache } = fakeAstro('401736287');
        const r = await (await load())(astro, 'wnba');
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(espn).toHaveBeenCalledWith('401736287', 'wnba');
        expect(proc.mock.calls[0][0]).toBe('401736287'); expect(proc.mock.calls[0][2]).toBe('wnba');
        expect((cache[0] as any).maxAge).toBe(86400); expect((cache[0] as any).tags).toContain('wnba');
    });
    test('a processor 404 on a game ESPN calls final is unavailable and never cached (#319 I1)', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(final()); proc.mockRejectedValueOnce(new ProcessorError(404, 'no plays'));
        const { astro, cache, headers } = fakeAstro('401736287');
        expect(await (await load())(astro, 'wnba')).toEqual({ unavailable: true });
        expect(cache).toEqual([false]); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a scheduled game (real ESPN page) is the pregame state; the processor is not asked', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(scheduled());
        const { astro, cache } = fakeAstro('401918306');
        const r = await (await load())(astro, 'wnba');
        expect('pregame' in r).toBe(true); expect(proc).not.toHaveBeenCalled();
        expect((cache[0] as any).tags).toContain('wnba');
    });
    test('an unknown id is a 404, an ESPN outage a 503 (#319 N1)', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: null, regressed: false, reason: null, fetchFailed: false });
        expect(await (await load())(fakeAstro('401999999').astro, 'wnba')).toEqual({ notFound: true });
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: null, regressed: false, reason: null, fetchFailed: true });
        expect(await (await load())(fakeAstro('401999999').astro, 'wnba')).toEqual({ unavailable: true });
    });
    test('a truncated ingested pbp falls through to the processor (sanity gate on halves: three periods needed)', async () => {
        const bad = read('game_250603003_api'); bad.pbp = bad.pbp.filter((p: any) => p.period_number <= 2);
        sched.mockResolvedValueOnce(bad.schedule[0]); rows.mockResolvedValueOnce(bad);
        espn.mockResolvedValueOnce({ page: { gameId: 250603003, gamepackageJSON: { header: read('game_250603003_processor').header } }, regressed: false, reason: null, fetchFailed: false });
        proc.mockResolvedValueOnce(read('game_250603003_processor'));
        const r = await (await load())(fakeAstro('250603003').astro, 'wnba');
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(store.render_outcome).toBe('degraded');
    });
});
