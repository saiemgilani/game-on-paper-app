import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ProcessorError } from '../../src/resources/python';

const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));
let store: any;
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), gopStorage: { getStore: () => store } }));

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/${name}.json`, import.meta.url)).toString());
const page = (p: unknown) => ({ page: p, regressed: false, reason: null, fetchFailed: false });
function fakeAstro(id: string) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com/wbb/game/${id}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const load = async () => (await import('../../src/routes/basketball/game')).prepareBasketballGame;

beforeEach(() => { [sched, rows, proc, espn].forEach((f) => f.mockReset()); store = { events: [], render_outcome: 'ok' }; });

describe("prepareBasketballGame(Astro, 'wbb') on real WBB rows and pages", () => {
    test('an ingested quarters final renders from the wbb Data API, no ESPN call, held a year under the wbb tag', async () => {
        const api = read('game_401805076_api');
        sched.mockResolvedValueOnce(api.schedule[0]); rows.mockResolvedValueOnce(api);
        const { astro, cache } = fakeAstro('401805076');
        const r = await (await load())(astro, 'wbb');
        expect('game' in r && r.game.source === 'data_api' && r.game.regulation === 4 && r.game.periods === 5).toBe(true);
        expect(astro.locals.league).toBe('wbb');
        expect(sched).toHaveBeenCalledWith('401805076', 'wbb'); expect(rows).toHaveBeenCalledWith('401805076', 'wbb');
        expect(espn).not.toHaveBeenCalled(); expect(proc).not.toHaveBeenCalled();
        expect((cache[0] as any).tags).toEqual(['game-completed', 'wbb']);
    });
    test('an ingested 2014 halves final passes the gate (release = processor = 54-56 after the republish) and renders from the Data API (Decision 7)', async () => {
        const api = read('game_400550784_api');
        sched.mockResolvedValueOnce(api.schedule[0]); rows.mockResolvedValueOnce(api);
        const r = await (await load())(fakeAstro('400550784').astro, 'wbb');
        expect('game' in r && [r.game.source, r.game.regulation, r.game.periodKind, r.game.periods]).toEqual(['data_api', 2, 'half', 2]);
        expect('game' in r && [r.game.home.score, r.game.away.score].map(Number)).toEqual([54, 56]);
        expect(espn).not.toHaveBeenCalled(); expect(proc).not.toHaveBeenCalled();
        expect(store.render_outcome).toBe('ok');
    });
    test('a final the Data API lacks goes to /wbb/<id>/process and is held one day', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(page(read('espn_page_401805076'))); proc.mockResolvedValueOnce(read('game_401805076_processor'));
        const { astro, cache } = fakeAstro('401805076');
        const r = await (await load())(astro, 'wbb');
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(espn).toHaveBeenCalledWith('401805076', 'wbb');
        expect(proc.mock.calls[0][0]).toBe('401805076'); expect(proc.mock.calls[0][2]).toBe('wbb');
        expect((cache[0] as any).maxAge).toBe(86400); expect((cache[0] as any).tags).toContain('wbb');
    });
    test('a processor 404 on a game ESPN calls final is unavailable and never cached (#319 I1)', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(page(read('espn_page_401805076'))); proc.mockRejectedValueOnce(new ProcessorError(404, 'no plays'));
        const { astro, cache, headers } = fakeAstro('401805076');
        expect(await (await load())(astro, 'wbb')).toEqual({ unavailable: true });
        expect(cache).toEqual([false]); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a scheduled game (real staged ESPN page) is the pregame state; the processor is not asked', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce(page(read('pregame_401920983')));
        const r = await (await load())(fakeAstro('401920983').astro, 'wbb');
        expect('pregame' in r).toBe(true); expect(proc).not.toHaveBeenCalled();
    });
    test('an unknown id is a 404, an ESPN outage a 503 (#319 N1)', async () => {
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: null, regressed: false, reason: null, fetchFailed: false });
        expect(await (await load())(fakeAstro('401999999').astro, 'wbb')).toEqual({ notFound: true });
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: null, regressed: false, reason: null, fetchFailed: true });
        expect(await (await load())(fakeAstro('401999999').astro, 'wbb')).toEqual({ unavailable: true });
    });
    test('a truncated ingested pbp falls through (the gate asks for every quarter of a quarters game)', async () => {
        const bad = read('game_401827362_api'); bad.pbp = bad.pbp.filter((p: any) => Number(p.period_number) <= 2);
        sched.mockResolvedValueOnce(bad.schedule[0]); rows.mockResolvedValueOnce(bad);
        espn.mockResolvedValueOnce(page({ gameId: 401827362, gamepackageJSON: { header: read('game_401827362_processor').header } }));
        proc.mockResolvedValueOnce(read('game_401827362_processor'));
        const r = await (await load())(fakeAstro('401827362').astro, 'wbb');
        expect('game' in r && r.game.source === 'processor').toBe(true);
        expect(store.render_outcome).toBe('degraded');
        expect(store.events.at(-1).row.message).toContain('pbp: no plays in period 3');
    });
});
