// test/nba/playersRoute.test.ts
import { describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './rows';

const feed: { fail: boolean; empty: boolean } = { fail: false, empty: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => { if (feed.fail) throw new Error('down'); return feed.empty ? [] : apiSeasonPlayerRows(); },
}));

import { NETS_TEAM_ID } from '../../src/nba/data/teams';
import { SEASON_CACHE } from '../../src/routes/nba/cache';
import { prepareNbaPlayers } from '../../src/routes/nba/players';

const api = apiSeasonPlayerRows();
const ok = (r: Awaited<ReturnType<typeof prepareNbaPlayers>>) => { if ('notFound' in r || 'unavailable' in r) throw new Error(`unexpected ${JSON.stringify(r)}`); return r; };

function fakeAstro(path: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareNbaPlayers', () => {
    test("defaults to the season's Nets, most attempts first, cached for the season window", async () => {
        const { astro, cache } = fakeAstro('/nba/players');
        const r = ok(await prepareNbaPlayers(astro));
        expect(r.team).toBe('BKN');
        expect(r.selected?.team_id).toBe(NETS_TEAM_ID);
        expect(r.teams.length).toBe(30);
        expect(r.rows.length).toBe(api.filter((x) => x.team_id === NETS_TEAM_ID).length);
        expect(r.rows[0].attempts).toBeGreaterThanOrEqual(r.rows[1].attempts);
        expect(r.sort).toBe('attempts');
        expect(r.dir).toBe('desc');
        expect(r.defaults).toEqual({ season: '2026', team: 'BKN' });
        expect(cache[0]).toEqual(SEASON_CACHE);
        expect(astro.locals.league).toBe('nba');
    });
    test('?team=ALL lists every player once, on his primary team', async () => {
        const r = ok(await prepareNbaPlayers(fakeAstro('/nba/players?team=ALL').astro));
        expect(r.selected).toBeNull();
        expect(r.team).toBe('ALL');
        expect(r.rows.length).toBe(new Set(api.map((x) => x.person_id)).size);
    });
    test('a tricode selects that team; a franchise tricode from another season selects the franchise', async () => {
        const bos = ok(await prepareNbaPlayers(fakeAstro('/nba/players?team=BOS').astro));
        expect(bos.selected?.tricode).toBe('BOS');
        expect(bos.rows.every((row) => row.team === 'BOS')).toBe(true);
        const njn = ok(await prepareNbaPlayers(fakeAstro('/nba/players?team=NJN').astro));
        expect(njn.selected?.team_id).toBe(NETS_TEAM_ID);
        expect(njn.team).toBe('BKN');
    });
    test('an unknown tricode is a 404, uncacheable', async () => {
        const { astro, cache, headers } = fakeAstro('/nba/players?team=ZZZ');
        expect(await prepareNbaPlayers(astro)).toEqual({ notFound: true });
        expect(cache).toEqual([false]);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('?sort= and ?dir= are whitelisted; a bad value is the default', async () => {
        const byFg = ok(await prepareNbaPlayers(fakeAstro('/nba/players?team=ALL&sort=fgPct&dir=asc').astro));
        expect(byFg.sort).toBe('fgPct');
        expect(byFg.dir).toBe('asc');
        expect(byFg.rows[0].fgPct).not.toBeNull();
        expect(byFg.rows[0].fgPct!).toBeLessThanOrEqual(byFg.rows[1].fgPct ?? 1);
        const bad = ok(await prepareNbaPlayers(fakeAstro('/nba/players?sort=drop%20table&dir=sideways').astro));
        expect(bad.sort).toBe('attempts');
        expect(bad.dir).toBe('desc');
    });
    test('a season with no rows renders empty for the requested team, uncacheable', async () => {
        feed.empty = true;
        try {
            const { astro, cache } = fakeAstro('/nba/players?season=2026');
            const r = ok(await prepareNbaPlayers(astro));
            expect(r.rows).toEqual([]);
            expect(r.teams).toEqual([]);
            expect(r.team).toBe('BKN');
            expect(cache).toEqual([false]);
        } finally { feed.empty = false; }
    });
    test('a failed read is unavailable and uncacheable', async () => {
        feed.fail = true;
        try {
            const { astro, cache } = fakeAstro('/nba/players');
            expect(await prepareNbaPlayers(astro)).toEqual({ unavailable: true });
            expect(cache).toEqual([false]);
        } finally { feed.fail = false; }
    });
});
