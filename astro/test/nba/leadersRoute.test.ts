// test/nba/leadersRoute.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import type { PlayerGameRow } from '../../src/resources/nbaShots';
import { seasonPlayerRows } from './rows';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const byPlayer = read('player_games') as Record<string, any[]>;
const gameRows = (): PlayerGameRow[] => Object.entries(byPlayer).flatMap(([pid, games]) => games.map((g) => ({
    season: 2026, person_id: Number(pid), game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
    fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
})));
const feed = { playersFail: false, gamesFail: false, gamesEmpty: false, nullDates: false, playersEmpty: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => { if (feed.playersFail) throw new Error('down'); return feed.playersEmpty ? [] : seasonPlayerRows(); },
    retrieveSeasonPlayerGameRows: async () => {
        if (feed.gamesFail) throw new Error('down');
        if (feed.gamesEmpty) return [];
        return feed.nullDates ? gameRows().map((r) => ({ ...r, game_date: null })) : gameRows();
    },
}));

import { LEADER_METRICS, LEADER_WINDOWS } from '../../src/nba/data/leaders';
import { SEASON_CACHE } from '../../src/routes/nba/cache';
import { prepareNbaLeaders } from '../../src/routes/nba/leaders';

const ok = (r: Awaited<ReturnType<typeof prepareNbaLeaders>>) => { if ('unavailable' in r) throw new Error('unexpected'); return r; };
function fakeAstro(path: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareNbaLeaders', () => {
    test('every window x metric board from the season rows, Nets flagged in also, season cache', async () => {
        const { astro, cache } = fakeAstro('/nba/leaders?season=2026');
        const r = ok(await prepareNbaLeaders(astro));
        expect(r.boards).not.toBeNull();
        for (const n of LEADER_WINDOWS) for (const m of LEADER_METRICS) expect(r.boards![n][m].rows.length).toBeGreaterThan(0);
        const board = r.boards![10].efgPct;
        expect(board.rows[0].rank).toBe(1);
        expect(board.rows.every((row) => row.window.games === 10)).toBe(true);
        expect(cache[0]).toEqual(SEASON_CACHE);
        expect(astro.locals.league).toBe('nba');
    });
    test('no game rows, or rows the logs cannot place, give boards null (the page says so), still a season page', async () => {
        for (const key of ['gamesEmpty', 'nullDates'] as const) {
            feed[key] = true;
            try {
                const { astro, cache } = fakeAstro('/nba/leaders?season=2026');
                expect(ok(await prepareNbaLeaders(astro)).boards, key).toBeNull();
                expect(cache[0]).toEqual(SEASON_CACHE);
            } finally { feed[key] = false; }
        }
    });
    test('a failed read is unavailable; an empty season is empty and uncacheable', async () => {
        for (const key of ['playersFail', 'gamesFail'] as const) {
            feed[key] = true;
            try {
                const { astro, cache } = fakeAstro('/nba/leaders');
                expect(await prepareNbaLeaders(astro), key).toEqual({ unavailable: true });
                expect(cache).toEqual([false]);
            } finally { feed[key] = false; }
        }
        feed.playersEmpty = true; feed.gamesEmpty = true;
        try {
            const { astro, cache } = fakeAstro('/nba/leaders');
            expect(ok(await prepareNbaLeaders(astro)).boards).toBeNull();
            expect(cache).toEqual([false]);
        } finally { feed.playersEmpty = false; feed.gamesEmpty = false; }
    });
});
