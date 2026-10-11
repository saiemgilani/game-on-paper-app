// test/nba/teamsRoute.test.ts
import { describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './rows';

const feed: { fail: boolean; empty: boolean } = { fail: false, empty: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => { if (feed.fail) throw new Error('down'); return feed.empty ? [] : apiSeasonPlayerRows(); },
}));

import { NETS_TEAM_ID } from '../../src/nba/data/teams';
import { SEASON_CACHE } from '../../src/routes/nba/cache';
import { LAST_KNOWN_SEASON } from '../../src/nba/seasonRange';
import { prepareNbaTeams } from '../../src/routes/nba/teams';

function fakeAstro(path: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareNbaTeams', () => {
    test('30 teams for the season with their lines, cached for the season window', async () => {
        const { astro, cache } = fakeAstro('/nba/teams');
        const r = await prepareNbaTeams(astro);
        if ('unavailable' in r) throw new Error('unexpected');
        expect(r.season).toBe(LAST_KNOWN_SEASON);
        expect(r.q).toBe('');
        expect(r.teams.length).toBe(30);
        expect(r.lines.get(NETS_TEAM_ID)?.attempts).toBeGreaterThan(0);
        expect(cache[0]).toEqual(SEASON_CACHE);
        expect(astro.locals.league).toBe('nba');
    });
    test('a bad season resolves to the current one before the read', async () => {
        const r = await prepareNbaTeams(fakeAstro('/nba/teams?season=1700').astro);
        expect('unavailable' in r ? null : r.season).toBe(LAST_KNOWN_SEASON);
    });
    test('a failed read is unavailable and uncacheable', async () => {
        feed.fail = true;
        try {
            const { astro, cache, headers } = fakeAstro('/nba/teams');
            expect(await prepareNbaTeams(astro)).toEqual({ unavailable: true });
            expect(cache).toEqual([false]);
            expect(headers.get('Cache-Control')).toBe('no-store');
        } finally { feed.fail = false; }
    });
    test('a season with no rows renders empty and uncacheable', async () => {
        feed.empty = true;
        try {
            const { astro, cache } = fakeAstro('/nba/teams?season=2026');
            const r = await prepareNbaTeams(astro);
            expect('unavailable' in r ? null : r.teams).toEqual([]);
            expect(cache).toEqual([false]);
        } finally { feed.empty = false; }
    });
});
