// test/nba/teamRoute.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './rows';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const oracle = read('league_context');
const shots = read('shots') as any[]; // blazing's 2,000-row Nets 2025-26 dump
const feed = { playersFail: false, contextFail: false, shotsFail: false, shotsEmpty: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => { if (feed.playersFail) throw new Error('down'); return apiSeasonPlayerRows(); },
    retrieveLeagueContextRows: async () => {
        if (feed.contextFail) throw new Error('down');
        return [
            ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
            { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
        ];
    },
    retrieveTeamShots: async (_s: number, teamId: number) => {
        if (feed.shotsFail) throw new Error('down');
        return feed.shotsEmpty ? [] : shots.filter((s) => s.team_id === teamId).map((s) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result }));
    },
}));

import { NETS_TEAM_ID } from '../../src/nba/data/teams';
import { PLAYER_CACHE } from '../../src/routes/nba/cache';
import { prepareNbaTeam } from '../../src/routes/nba/team';

const ok = (r: Awaited<ReturnType<typeof prepareNbaTeam>>) => { if ('notFound' in r || 'unavailable' in r) throw new Error(`unexpected ${JSON.stringify(r)}`); return r; };
function fakeAstro(id: string, query = '') {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com/nba/team/${id}${query}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareNbaTeam', () => {
    test('the Nets: line from their shots, dashboard built, roster from the season rows, player-page cache', async () => {
        const { astro, cache } = fakeAstro(String(NETS_TEAM_ID), '?season=2026');
        const r = ok(await prepareNbaTeam(astro));
        const mine = shots.filter((s) => s.team_id === NETS_TEAM_ID);
        expect(r.team.team_id).toBe(NETS_TEAM_ID);
        expect(r.team.name).toBe('Brooklyn Nets');
        expect(r.line.attempts).toBe(mine.length);
        expect(r.line.makes).toBe(mine.filter((s) => s.shot_result === 'Made').length);
        expect(Object.keys(r.dashboard!).sort()).toEqual(['bars', 'hex', 'sides', 'signature']);
        expect(r.roster.length).toBe(apiSeasonPlayerRows().filter((x) => x.team_id === NETS_TEAM_ID).length);
        expect(r.roster[0].fga).toBeGreaterThanOrEqual(r.roster[1].fga);
        expect(r.sort).toBe('fga');
        expect(r.mode).toBe('totals');
        expect(cache[0]).toEqual(PLAYER_CACHE);
        expect(astro.locals.league).toBe('nba');
    });
    test('?sort=, ?dir= and ?mode= are whitelisted and applied', async () => {
        const r = ok(await prepareNbaTeam(fakeAstro(String(NETS_TEAM_ID), '?sort=min&dir=asc&mode=pergame').astro));
        expect([r.sort, r.dir, r.mode]).toEqual(['min', 'asc', 'pergame']);
        const withMin = r.roster.filter((x) => x.minPg !== null);
        expect(withMin[0].minPg!).toBeLessThanOrEqual(withMin[1].minPg!);
        const bad = ok(await prepareNbaTeam(fakeAstro(String(NETS_TEAM_ID), '?sort=x&dir=y&mode=z').astro));
        expect([bad.sort, bad.dir, bad.mode]).toEqual(['fga', 'desc', 'totals']);
    });
    test('a malformed id is a 404 before any read; an unknown team for the season is a 404', async () => {
        for (const id of ['abc', '', '12345678901']) {
            const { astro, cache } = fakeAstro(id);
            expect(await prepareNbaTeam(astro)).toEqual({ notFound: true });
            expect(cache).toEqual([false]);
        }
        const { astro, headers } = fakeAstro('1'); // not a team_id in the 2026 rows
        expect(await prepareNbaTeam(astro)).toEqual({ notFound: true });
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('a team in the rows but with no shots is a 404, not an empty dashboard', async () => {
        feed.shotsEmpty = true;
        try { expect(await prepareNbaTeam(fakeAstro(String(NETS_TEAM_ID)).astro)).toEqual({ notFound: true }); }
        finally { feed.shotsEmpty = false; }
    });
    test('any of the three reads failing is a 503, uncacheable', async () => {
        for (const key of ['playersFail', 'contextFail', 'shotsFail'] as const) {
            feed[key] = true;
            try {
                const { astro, cache, headers } = fakeAstro(String(NETS_TEAM_ID));
                expect(await prepareNbaTeam(astro), key).toEqual({ unavailable: true });
                expect(cache).toEqual([false]);
                expect(headers.get('Cache-Control')).toBe('no-store');
            } finally { feed[key] = false; }
        }
    });
});
