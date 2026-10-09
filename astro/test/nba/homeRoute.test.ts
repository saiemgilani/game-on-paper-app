import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const players = JSON.parse(readFileSync(new URL('../fixtures/nba/season_players.json', import.meta.url)).toString());
const rows = players.map((p: any) => ({
    season: 2026, person_id: p.person_id, player_name: p.player_name, team_id: p.team_id, team_tricode: p.team_tricode,
    attempts: p.attempts, makes: p.makes, fg3a: p.fg3a, fg3m: p.fg3m, ra_attempts: 0, ra_makes: 0, mid_attempts: 0, mid_makes: 0,
    is_primary: true, n_teams: 1, has_stats: p.stats !== null, gp: p.stats?.gp ?? null, min_pg: p.stats?.min ?? null,
    fga_total: p.stats?.fga ?? null, fg_pct: p.stats?.fg_pct ?? null, efg_pct: p.stats?.efg_pct ?? null, ts_pct: p.stats?.ts_pct ?? null,
    usg_pct: p.stats?.usg_pct ?? null, pie: p.stats?.pie ?? null, pts_pg: p.stats?.pts_pg ?? null, fga_pg: p.stats?.fga_pg ?? null,
    min_total: p.stats?.min_total ?? null, headshot_href: null,
}));
const feed: { fail: boolean } = { fail: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => { if (feed.fail) throw new Error('down'); return rows; },
}));

import { prepareNbaHome } from '../../src/routes/nba/home';

function fakeAstro(path: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareNbaHome', () => {
    test('the current season by default, cached for the season window', async () => {
        const { astro, cache } = fakeAstro('/nba');
        const r = await prepareNbaHome(astro);
        expect('unavailable' in r).toBe(false);
        if ('unavailable' in r) return;
        expect(r.season).toBe(2026);
        expect(r.q).toBe('');
        expect(r.roster.length).toBe(players.length);
        expect(r.roster[0].attempts).toBeGreaterThanOrEqual(r.roster[1].attempts);
        expect(cache[0]).toMatchObject({ maxAge: 21600, tags: ['nba'] });
        expect(astro.locals.league).toBe('nba');
    });
    test('test_bad_season_resolves_to_current', async () => {
        for (const p of ['/nba?season=1996', '/nba?season=abc', '/nba?season=20260']) {
            const r = await prepareNbaHome(fakeAstro(p).astro);
            expect('unavailable' in r ? null : r.season, p).toBe(2026);
        }
        const r = await prepareNbaHome(fakeAstro('/nba?season=2013').astro);
        expect('unavailable' in r ? null : r.q).toBe('?season=2013');
    });
    test('a failed read is unavailable and uncacheable', async () => {
        feed.fail = true;
        try {
            const { astro, cache, headers } = fakeAstro('/nba');
            const r = await prepareNbaHome(astro);
            expect(r).toEqual({ unavailable: true });
            expect(cache).toEqual([false]);
            expect(headers.get('Cache-Control')).toBe('no-store');
        } finally {
            feed.fail = false;
        }
    });
});
