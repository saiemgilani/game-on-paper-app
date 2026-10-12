// Route-level cache policy for past days (final-review fix wave).
import { beforeEach, describe, expect, test, vi } from 'vitest';

const sb = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), getScoreboardForDay: (...a: unknown[]) => sb(...a) }));

function fakeAstro(path: string) {
    const cache: unknown[] = [];
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
const liveDay = { day: '2026-10-21', events: [], degraded: false };

beforeEach(() => sb.mockReset());

describe('past-day cache policy', () => {
    test('within 7 days: 1-day policy, pastDay only; over 7 days: 14 days, oldDay', async () => {
        const { prepareNbaScoreboard, PAST_DAY_CACHE, OLD_DAY_CACHE } = await import('../../src/routes/nba/scoreboard');
        expect(OLD_DAY_CACHE.maxAge).toBe(14 * 86400);
        sb.mockResolvedValueOnce(liveDay).mockResolvedValueOnce({ day: '2026-10-14', events: [], degraded: false });
        let t = fakeAstro('/nba/scoreboard?date=2026-10-14');
        await prepareNbaScoreboard(t.astro);
        expect(sb).toHaveBeenLastCalledWith('nba', '20261014', { pastDay: true });
        expect(t.cache[0]).toEqual(PAST_DAY_CACHE);
        sb.mockResolvedValueOnce(liveDay).mockResolvedValueOnce({ day: '2026-10-13', events: [], degraded: false });
        t = fakeAstro('/nba/scoreboard?date=2026-10-13');
        await prepareNbaScoreboard(t.astro);
        expect(sb).toHaveBeenLastCalledWith('nba', '20261013', { pastDay: true, oldDay: true });
        expect(t.cache[0]).toEqual(OLD_DAY_CACHE);
    });
    test('undated reflects whether ?date= was given', async () => {
        const { prepareNbaScoreboard } = await import('../../src/routes/nba/scoreboard');
        sb.mockResolvedValueOnce(liveDay);
        expect(await prepareNbaScoreboard(fakeAstro('/nba/scoreboard').astro)).toMatchObject({ undated: true });
        sb.mockResolvedValueOnce(liveDay).mockResolvedValueOnce({ day: '2025-04-15', events: [], degraded: false });
        expect(await prepareNbaScoreboard(fakeAstro('/nba/scoreboard?date=2025-04-15').astro)).toMatchObject({ undated: false });
    });
});
