import { beforeEach, describe, expect, test, vi } from 'vitest';

const sb = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), getScoreboardForDay: (...a: unknown[]) => sb(...a) }));
const pushed: unknown[] = [];
vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()), gopStorage: { getStore: () => ({ events: pushed }) } }));

function fakeAstro(path: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const game = (id: string, day: string, name = 'STATUS_SCHEDULED') => ({ id, date: `${day}T23:00Z`, season: { year: 2027 }, competitions: [{ date: `${day}T23:00Z`, status: { type: { name } }, competitors: [
    { homeAway: 'home', score: '0', team: { abbreviation: 'ORL' } }, { homeAway: 'away', score: '0', team: { abbreviation: 'ATL' } } ] }], status: { type: { name } } });
const liveDay = (day = '2026-10-21', extra: object = {}) => ({ day, events: [], degraded: false, ...extra });

beforeEach(() => { sb.mockReset(); pushed.length = 0; });

describe('prepareNbaScoreboard', () => {
    test('no date: the live day, live cache policy, telemetry rows', async () => {
        sb.mockResolvedValueOnce({ day: '2026-10-21', events: [game('1', '2026-10-21')], degraded: false });
        const { prepareNbaScoreboard, LIVE_SCOREBOARD_CACHE } = await import('../../src/routes/nba/scoreboard');
        const { astro, cache } = fakeAstro('/nba/scoreboard');
        const r = await prepareNbaScoreboard(astro);
        expect('badDate' in r).toBe(false);
        if ('badDate' in r) return;
        expect(r.isLive && r.day === '2026-10-21' && r.games.length === 1).toBe(true);
        expect(cache[0]).toEqual(LIVE_SCOREBOARD_CACHE);
        expect(sb).toHaveBeenCalledTimes(1);
        expect(sb).toHaveBeenCalledWith('nba', null);
        expect(pushed).toHaveLength(1);
        expect((pushed[0] as any).row).toMatchObject({ game_id: 1, week: null, home_abbr: 'ORL', away_abbr: 'ATL' });
        expect(astro.locals.league).toBe('nba');
    });
    test("?date= equal to ESPN's current day is the live page (with telemetry)", async () => {
        sb.mockResolvedValueOnce({ day: '2026-10-21', events: [game('1', '2026-10-21')], degraded: false });
        const { prepareNbaScoreboard, LIVE_SCOREBOARD_CACHE } = await import('../../src/routes/nba/scoreboard');
        const { astro, cache } = fakeAstro('/nba/scoreboard?date=2026-10-21');
        const r = await prepareNbaScoreboard(astro);
        expect(sb).toHaveBeenCalledTimes(1);
        expect(cache[0]).toEqual(LIVE_SCOREBOARD_CACHE);
        expect(pushed).toHaveLength(1);
        expect(!('badDate' in r) && r.isLive).toBe(true);
    });
    test('a past day reads the dated scoreboard as pastDay, caches a day, writes no telemetry', async () => {
        sb.mockResolvedValueOnce(liveDay());
        sb.mockResolvedValueOnce({ day: '2025-04-15', events: [game('9', '2025-04-15', 'STATUS_FINAL')], degraded: false });
        const { prepareNbaScoreboard, PAST_DAY_CACHE } = await import('../../src/routes/nba/scoreboard');
        const { astro, cache } = fakeAstro('/nba/scoreboard?date=2025-04-15');
        const r = await prepareNbaScoreboard(astro);
        expect(sb).toHaveBeenNthCalledWith(2, 'nba', '20250415', { pastDay: true });
        expect(cache[0]).toEqual(PAST_DAY_CACHE);
        expect(pushed).toHaveLength(0);
        expect(!('badDate' in r) && !r.isLive && r.games[0].id === '9' && r.nav.prev === '2025-04-14').toBe(true);
    });
    test('a future day caches an hour and is not pastDay', async () => {
        sb.mockResolvedValueOnce(liveDay());
        sb.mockResolvedValueOnce({ day: '2026-10-25', events: [], degraded: false });
        const { prepareNbaScoreboard, FUTURE_DAY_CACHE } = await import('../../src/routes/nba/scoreboard');
        const { astro, cache } = fakeAstro('/nba/scoreboard?date=2026-10-25');
        await prepareNbaScoreboard(astro);
        expect(sb).toHaveBeenNthCalledWith(2, 'nba', '20261025', {});
        expect(cache[0]).toEqual(FUTURE_DAY_CACHE);
    });
    test('a bad date makes zero ESPN calls and is uncacheable', async () => {
        const { prepareNbaScoreboard } = await import('../../src/routes/nba/scoreboard');
        for (const [q, reason] of [['2025-02-30', 'calendar'], ['x', 'format'], ['1990-01-01', 'range'], ['2999-01-01', 'range']] as const) {
            const { astro, cache, headers } = fakeAstro(`/nba/scoreboard?date=${q}`);
            expect(await prepareNbaScoreboard(astro)).toEqual({ badDate: reason });
            expect(cache).toEqual([false]);
            expect(headers.get('Cache-Control')).toBe('no-store');
        }
        expect(sb).not.toHaveBeenCalled();
    });
    test('a degraded dated day is uncacheable and still returns the navigation', async () => {
        sb.mockResolvedValueOnce(liveDay());
        sb.mockResolvedValueOnce({ day: '2025-04-15', events: [], degraded: true });
        const { prepareNbaScoreboard } = await import('../../src/routes/nba/scoreboard');
        const { astro, cache, headers } = fakeAstro('/nba/scoreboard?date=2025-04-15');
        const r = await prepareNbaScoreboard(astro);
        expect(cache).toEqual([false]);
        expect(headers.get('Cache-Control')).toBe('no-store');
        expect(!('badDate' in r) && r.degraded && r.nav.label === 'Tuesday, April 15').toBe(true);
    });
    test('live read degraded: ?date=<server day> is not the live page; dated fetch with {}, uncacheable, no telemetry', async () => {
        const serverDay = new Date().toISOString().slice(0, 10);
        sb.mockResolvedValueOnce({ day: serverDay, events: [], degraded: true });
        sb.mockResolvedValueOnce({ day: serverDay, events: [game('5', serverDay)], degraded: false });
        const { prepareNbaScoreboard } = await import('../../src/routes/nba/scoreboard');
        const { astro, cache, headers } = fakeAstro(`/nba/scoreboard?date=${serverDay}`);
        const r = await prepareNbaScoreboard(astro);
        expect(sb).toHaveBeenNthCalledWith(2, 'nba', serverDay.replaceAll('-', ''), {});
        expect(cache).toEqual([false]);
        expect(headers.get('Cache-Control')).toBe('no-store');
        expect(pushed).toHaveLength(0);
        expect(!('badDate' in r) && !r.isLive).toBe(true);
    });
    test('live read degraded, no date: unavailable, uncacheable, no telemetry', async () => {
        sb.mockResolvedValueOnce({ day: '2026-10-21', events: [], degraded: true });
        const { prepareNbaScoreboard } = await import('../../src/routes/nba/scoreboard');
        const { astro, cache, headers } = fakeAstro('/nba/scoreboard');
        const r = await prepareNbaScoreboard(astro);
        expect(cache).toEqual([false]);
        expect(headers.get('Cache-Control')).toBe('no-store');
        expect(!('badDate' in r) && r.degraded && r.games.length === 0).toBe(true);
        expect(pushed).toHaveLength(0);
    });
    test('stale (last-good) live read: games render, uncacheable, no telemetry; a dated past day is not pastDay', async () => {
        sb.mockResolvedValueOnce(liveDay('2026-10-19', { stale: true, events: [game('1', '2026-10-19')] }));
        const { prepareNbaScoreboard } = await import('../../src/routes/nba/scoreboard');
        let t = fakeAstro('/nba/scoreboard');
        const r = await prepareNbaScoreboard(t.astro);
        expect(!('badDate' in r) && r.games.length === 1).toBe(true);
        expect(t.cache).toEqual([false]);
        expect(t.headers.get('Cache-Control')).toBe('no-store');
        expect(pushed).toHaveLength(0);

        sb.mockResolvedValueOnce(liveDay('2026-10-19', { stale: true }));
        sb.mockResolvedValueOnce({ day: '2025-04-15', events: [], degraded: false });
        t = fakeAstro('/nba/scoreboard?date=2025-04-15');
        await prepareNbaScoreboard(t.astro);
        expect(sb).toHaveBeenLastCalledWith('nba', '20250415', {});
        expect(t.cache).toEqual([false]);
    });
});
