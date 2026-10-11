// test/nba/seasonRead.test.ts
import { describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './rows';

const feed: { fail: boolean; empty: boolean } = { fail: false, empty: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => { if (feed.fail) throw new Error('down'); return feed.empty ? [] : apiSeasonPlayerRows(); },
}));

import { SEASON_CACHE } from '../../src/routes/nba/cache';
import { readSeasonRows } from '../../src/routes/nba/season';

function fakeAstro() {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('readSeasonRows', () => {
    test('a failed read is null, uncacheable and no-store', async () => {
        feed.fail = true; feed.empty = false;
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const { astro, cache, headers } = fakeAstro();
            expect(await readSeasonRows(astro, 2026, '/nba/x')).toBeNull();
            expect(cache).toEqual([false]);
            expect(headers.get('Cache-Control')).toBe('no-store');
            expect(spy.mock.calls[0][0]).toContain('/nba/x');
        } finally { feed.fail = false; spy.mockRestore(); }
    });
    test('an empty season is [] and uncacheable', async () => {
        feed.empty = true;
        try {
            const { astro, cache } = fakeAstro();
            expect(await readSeasonRows(astro, 2026, '/nba/x')).toEqual([]);
            expect(cache).toEqual([false]);
        } finally { feed.empty = false; }
    });
    test('rows are returned and cached for the season window', async () => {
        const { astro, cache } = fakeAstro();
        const rows = await readSeasonRows(astro, 2026, '/nba/x');
        expect(rows!.length).toBeGreaterThan(0);
        expect(cache).toEqual([SEASON_CACHE]);
    });
});
