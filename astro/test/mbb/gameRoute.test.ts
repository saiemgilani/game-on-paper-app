import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ProcessorError } from '../../src/resources/python';

const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));
let store: any;
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), gopStorage: { getStore: () => store } }));

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mbb/${name}.json`, import.meta.url)).toString());
const page = (p: unknown) => ({ page: p, regressed: false, reason: null, fetchFailed: false });
function fakeAstro(id: string) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com/mbb/game/${id}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const load = async () => (await import('../../src/routes/basketball/game')).prepareBasketballGame;

beforeEach(() => { [sched, rows, proc, espn].forEach((f) => f.mockReset()); store = { events: [], render_outcome: 'ok' }; });

describe("prepareBasketballGame(Astro, 'mbb') on real MBB rows and pages", () => {
    test('an ingested final renders from the mbb Data API, no ESPN call, held a year under the mbb tag', async () => {
        const api = read('game_401820775_api');
        sched.mockResolvedValueOnce(api.schedule[0]); rows.mockResolvedValueOnce(api);
        const { astro, cache } = fakeAstro('401820775');
        const r = await (await load())(astro, 'mbb');
        expect('game' in r && r.game.source === 'data_api' && r.game.regulation === 2 && r.game.periods === 3).toBe(true);
        expect(astro.locals.league).toBe('mbb');
        expect(sched).toHaveBeenCalledWith('401820775', 'mbb'); expect(rows).toHaveBeenCalledWith('401820775', 'mbb');
        expect(espn).not.toHaveBeenCalled(); expect(proc).not.toHaveBeenCalled();
        expect((cache[0] as any).tags).toEqual(['game-completed', 'mbb']);
    });
    test('the republished neutral release passes the gate: 401829457 renders from the Data API (Decision 7, post-republish)', async () => {
        const api = read('game_401829457_api');
        sched.mockResolvedValueOnce(api.schedule[0]); rows.mockResolvedValueOnce(api);
        const r = await (await load())(fakeAstro('401829457').astro, 'mbb');
        expect('game' in r && r.game.source).toBe('data_api');
        expect('game' in r && [r.game.home.score, r.game.away.score].map(Number)).toEqual([58, 75]);
        expect(espn).not.toHaveBeenCalled(); expect(store.render_outcome).toBe('ok');
    });
    test('a final the Data API lacks goes to /mbb/<id>/process and is held one day', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(page(read('espn_page_401820775'))); proc.mockResolvedValueOnce(read('game_401820775_processor'));
        const { astro, cache } = fakeAstro('401820775');
        const r = await (await load())(astro, 'mbb');
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(espn).toHaveBeenCalledWith('401820775', 'mbb');
        expect(proc.mock.calls[0][0]).toBe('401820775'); expect(proc.mock.calls[0][2]).toBe('mbb');
        expect((cache[0] as any).maxAge).toBe(86400); expect((cache[0] as any).tags).toContain('mbb');
    });
    test('a processor 404 on a game ESPN calls final is unavailable and never cached (#319 I1)', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(page(read('espn_page_401820775'))); proc.mockRejectedValueOnce(new ProcessorError(404, 'no plays'));
        const { astro, cache, headers } = fakeAstro('401820775');
        expect(await (await load())(astro, 'mbb')).toEqual({ unavailable: true });
        expect(cache).toEqual([false]); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a scheduled game (real ESPN page) is the pregame state; the processor is not asked', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(page(read('pregame_401920982')));
        const r = await (await load())(fakeAstro('401920982').astro, 'mbb');
        expect('pregame' in r).toBe(true); expect(proc).not.toHaveBeenCalled();
    });
    test('an unknown id is a 404, an ESPN outage a 503 (#319 N1)', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: null, regressed: false, reason: null, fetchFailed: false });
        expect(await (await load())(fakeAstro('401999999').astro, 'mbb')).toEqual({ notFound: true });
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: null, regressed: false, reason: null, fetchFailed: true });
        expect(await (await load())(fakeAstro('401999999').astro, 'mbb')).toEqual({ unavailable: true });
    });
    test('a truncated ingested pbp falls through to the processor, logged degraded (the gate asks for both halves)', async () => {
        const bad = read('game_401808271_api'); bad.pbp = bad.pbp.filter((p: any) => p.period_number === 1);
        sched.mockResolvedValueOnce(bad.schedule[0]); rows.mockResolvedValueOnce(bad);
        espn.mockResolvedValueOnce(page({ gameId: 401808271, gamepackageJSON: { header: read('game_401808271_processor').header } }));
        proc.mockResolvedValueOnce(read('game_401808271_processor'));
        const r = await (await load())(fakeAstro('401808271').astro, 'mbb');
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(store.render_outcome).toBe('degraded');
    });
});
