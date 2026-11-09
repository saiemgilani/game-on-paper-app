// astro/test/basketball/routes.test.ts
import { describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows, seasonPlayerRows } from '../nba/rows';

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (_s: number, league: string) => { if (league !== 'nba') throw new Error(`league ${league}`); return apiSeasonPlayerRows(); },
}));
const sb = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), getScoreboardForDay: (...a: unknown[]) => sb(...a) }));

function fakeAstro(path: string) {
    const cache: unknown[] = [];
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}

describe('basketball loaders: the nba shims are the basketball loaders called with nba', () => {
    test('teams and scatter: same params, league set, the season cache tagged with the league', async () => {
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const { prepareNbaTeams } = await import('../../src/routes/nba/teams');
        const { seasonCache } = await import('../../src/routes/basketball/cache');
        const { SEASON_CACHE } = await import('../../src/routes/nba/cache');
        const a = fakeAstro('/nba/teams?season=2026'), b = fakeAstro('/nba/teams?season=2026');
        const r = await prepareBasketballTeams(a.astro, 'nba');
        // the mock throws for any league but 'nba': a league mix-up would be {unavailable: true} on both sides
        expect(r).not.toHaveProperty('unavailable');
        expect(r).toEqual(await prepareNbaTeams(b.astro));
        expect(a.astro.locals.league).toBe('nba');
        expect(a.cache).toEqual(b.cache);
        expect(seasonCache('nba')).toEqual(SEASON_CACHE);
        expect(SEASON_CACHE).toEqual({ maxAge: 21600, swr: 21600, tags: ['nba'] });
    });
    test('scoreboard: caches and ESPN league come from the league', async () => {
        const { scoreboardCaches, prepareBasketballScoreboard } = await import('../../src/routes/basketball/scoreboard');
        const nba = await import('../../src/routes/nba/scoreboard');
        const c = scoreboardCaches('nba');
        expect([c.live, c.pastDay, c.oldDay, c.futureDay]).toEqual([nba.LIVE_SCOREBOARD_CACHE, nba.PAST_DAY_CACHE, nba.OLD_DAY_CACHE, nba.FUTURE_DAY_CACHE]);
        expect(c.live).toEqual({ maxAge: 60, swr: 120, tags: ['scoreboard', 'league:nba', 'nba'] });
        sb.mockResolvedValue({ day: '2026-10-12', events: [], degraded: false });
        const { astro } = fakeAstro('/nba/scoreboard?date=1997-09-30');
        expect(await prepareBasketballScoreboard(astro, 'nba')).toEqual({ badDate: 'range' }); // the config's firstScoreboardDay
        const ok = fakeAstro('/nba/scoreboard');
        await prepareBasketballScoreboard(ok.astro, 'nba');
        expect(sb).toHaveBeenLastCalledWith('nba', null);
    });
    test('the unavailable response and the game cache policy', async () => {
        const { unavailable } = await import('../../src/routes/basketball/cache');
        const { NBA_UNAVAILABLE } = await import('../../src/routes/nba/cache');
        const [a, b] = [unavailable('nba'), NBA_UNAVAILABLE()];
        expect([a.status, await a.text(), a.headers.get('Retry-After')]).toEqual([b.status, await b.text(), b.headers.get('Retry-After')]);
        const { getBasketballGameCacheConfig, getNbaGameCacheConfig } = await import('../../src/utils/config');
        const live = { type: { completed: false, name: 'STATUS_IN_PROGRESS' } } as any;
        const final = { type: { completed: true, name: 'STATUS_FINAL' } } as any;
        for (const st of [live, final]) expect(getBasketballGameCacheConfig('2026-10-12T00:00Z', st, 60, 'nba')).toEqual(getNbaGameCacheConfig('2026-10-12T00:00Z', st));
    });
    test("the home loader serves the nba's featured-team landing (its refusal path is exercised by plan #6's first teams-index league)", async () => {
        const { prepareBasketballHome } = await import('../../src/routes/basketball/home');
        const { astro } = fakeAstro('/nba');
        const r = await prepareBasketballHome(astro, 'nba');
        expect(r).toHaveProperty('roster');
        expect(astro.locals.league).toBe('nba');
        expect(seasonPlayerRows().length).toBeGreaterThan(0); // the Nets roster itself is pinned by home.render.test.ts and the byte-identity gate
    });
});
