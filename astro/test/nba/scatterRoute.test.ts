import { describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './rows';

const feed = { fail: false, empty: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => { if (feed.fail) throw new Error('down'); return feed.empty ? [] : apiSeasonPlayerRows(); },
}));

import { RANK_MIN_FGA } from '../../src/nba/data/ranks';
import { NETS_TEAM_ID } from '../../src/nba/data/teams';
import { SCATTER_METRICS } from '../../src/nba/scatterMetrics';
import { SEASON_CACHE } from '../../src/routes/nba/cache';
import { prepareNbaScatter } from '../../src/routes/nba/scatter';

function fakeAstro(path: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareNbaScatter', () => {
    test('every 100+ FGA player as a point, the Nets flagged, values in whitelist order, season cache', async () => {
        const { astro, cache } = fakeAstro('/nba/scatter');
        const r = await prepareNbaScatter(astro);
        if ('unavailable' in r) throw new Error('unexpected');
        const api = apiSeasonPlayerRows();
        const eligible = new Set(api.filter((x) => x.attempts >= RANK_MIN_FGA).map((x) => x.person_id));
        // league-wide points sum a traded player's rows, so the count is players whose SUM clears the bar
        const sums = new Map<number, number>();
        for (const x of api) sums.set(x.person_id, (sums.get(x.person_id) ?? 0) + x.attempts);
        expect(r.points.length).toBe([...sums.values()].filter((v) => v >= RANK_MIN_FGA).length);
        expect(r.points.length).toBeGreaterThanOrEqual(eligible.size);
        expect(r.points.some((p) => p.nets && p.team_id === NETS_TEAM_ID)).toBe(true);
        expect(r.points.every((p) => p.v.length === SCATTER_METRICS.length)).toBe(true);
        expect(cache[0]).toEqual(SEASON_CACHE);
        expect(astro.locals.league).toBe('nba');
    });
    test('a failed read is unavailable; an empty season renders no points, uncacheable', async () => {
        feed.fail = true;
        try {
            const { astro, cache } = fakeAstro('/nba/scatter');
            expect(await prepareNbaScatter(astro)).toEqual({ unavailable: true });
            expect(cache).toEqual([false]);
        } finally { feed.fail = false; }
        feed.empty = true;
        try {
            const { astro, cache } = fakeAstro('/nba/scatter?season=2026');
            const r = await prepareNbaScatter(astro);
            expect('unavailable' in r ? null : r.points).toEqual([]);
            expect(cache).toEqual([false]);
        } finally { feed.empty = false; }
    });
});
