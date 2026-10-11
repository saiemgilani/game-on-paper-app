// test/nba/playerRoute.test.ts
import { describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const players = read('season_players');
const shots = read('shots');
const playerGames = read('player_games');
const oracle = read('league_context');
const PID = Number(Object.keys(playerGames)[0]);

const playerRows = players.map((p: any) => ({
    season: 2026, person_id: p.person_id, player_name: p.player_name, team_id: p.team_id, team_tricode: p.team_tricode,
    attempts: p.attempts, makes: p.makes, fg3a: p.fg3a, fg3m: p.fg3m, ra_attempts: 0, ra_makes: 0, mid_attempts: 0, mid_makes: 0,
    is_primary: true, n_teams: 1, has_stats: p.stats !== null, gp: p.stats?.gp ?? null, min_pg: p.stats?.min ?? null,
    fga_total: null, fg_pct: p.stats?.fg_pct ?? null, efg_pct: null, ts_pct: p.stats?.ts_pct ?? null, usg_pct: null, pie: null,
    pts_pg: null, fga_pg: null, min_total: null, headshot_href: p.person_id === PID ? 'https://a.espncdn.com/x.png' : null,
}));
const contextRows = [
    ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
    { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
];
const gameRows = playerGames[PID].map((g: any) => ({
    season: 2026, person_id: PID, game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
    fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
}));
const state: { fail: Set<string>; nullDates: boolean; games: any[] | null } = { fail: new Set(), nullDates: false, games: null };
const guard = (name: string) => { if (state.fail.has(name)) throw new Error(`${name} down`); };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveLeagueContextRows: async () => { guard('context'); return contextRows; },
    retrieveSeasonPlayerRows: async () => { guard('players'); return playerRows; },
    retrievePlayerShots: async (_s: number, id: number) => { guard('shots'); return shots.filter((s: any) => s.person_id === id); },
    retrievePlayerGameRows: async () => { guard('games'); return state.games ?? (state.nullDates ? gameRows.map((r: any) => ({ ...r, game_date: null })) : gameRows); },
    retrievePlayerSeasons: async () => { guard('seasons'); return [2024, 2025, 2026]; },
}));

import { prepareNbaPlayer } from '../../src/routes/nba/player';
import { PLAYER_CACHE } from '../../src/routes/nba/cache';

function fakeAstro(path: string, id: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareNbaPlayer', () => {
    test('assembles the page from the five reads, cached per (id, season)', async () => {
        const { astro, cache } = fakeAstro(`/nba/players/${PID}`, String(PID));
        const r = await prepareNbaPlayer(astro);
        if ('notFound' in r || 'unavailable' in r) throw new Error('expected params');
        expect(r.player.person_id).toBe(PID);
        expect(r.line.attempts).toBe(shots.filter((s: any) => s.person_id === PID).length);
        expect(r.explorer.games?.length).toBe(gameRows.length);
        expect(r.explorer.league.hexIndex.hexes.length).toBe(oracle.hexes.length);
        expect(r.ranks.map((s) => s.metric)).toEqual(['fga', 'fgPct', 'efgPct', 'fg3Pct', 'tsPct']);
        expect(r.hisSeasons).toEqual([2024, 2025, 2026]);
        expect(r.headshot).toBe('https://a.espncdn.com/x.png');
        expect(r.teams).toEqual(['BKN']);
        expect(cache[0]).toEqual(PLAYER_CACHE);
    });
    test('test_unknown_player_is_not_found', async () => {
        for (const id of ['123', 'abc', '']) {
            const { astro, cache } = fakeAstro(`/nba/players/${id}`, id);
            expect(await prepareNbaPlayer(astro), id).toEqual({ notFound: true });
            expect(cache, id).toEqual([false]);
        }
    });
    test('test_api_outage_is_unavailable', async () => {
        for (const name of ['context', 'players', 'shots']) {
            state.fail = new Set([name]);
            const { astro, headers } = fakeAstro(`/nba/players/${PID}`, String(PID));
            expect(await prepareNbaPlayer(astro), name).toEqual({ unavailable: true });
            expect(headers.get('Cache-Control'), name).toBe('no-store');
        }
        state.fail = new Set();
    });
    test('a failed games or seasons read degrades the page and leaves it uncached', async () => {
        state.fail = new Set(['games', 'seasons']);
        const { astro, cache } = fakeAstro(`/nba/players/${PID}`, String(PID));
        const r = await prepareNbaPlayer(astro);
        state.fail = new Set();
        if ('notFound' in r || 'unavailable' in r) throw new Error('expected params');
        expect(r.explorer.games).toBeNull();
        expect(r.hisSeasons).toEqual([2026]);
        expect(cache).toEqual([false]);
    });
    test('null game dates mean the per-game views are unavailable, page still cached', async () => {
        state.nullDates = true;
        const { astro, cache } = fakeAstro(`/nba/players/${PID}`, String(PID));
        const r = await prepareNbaPlayer(astro);
        state.nullDates = false;
        if ('notFound' in r || 'unavailable' in r) throw new Error('expected params');
        expect(r.explorer.games).toBeNull();
        expect(cache[0]).toMatchObject({ maxAge: 3600 });
    });
    test('a shot whose game has no log row means the per-game views are unavailable', async () => {
        const shotGames = new Set(shots.filter((s: any) => s.person_id === PID).map((s: any) => String(s.game_id)));
        const dropped = gameRows.findIndex((g: any) => shotGames.has(String(g.game_id)));
        expect(dropped).toBeGreaterThanOrEqual(0);
        for (const [label, rows] of [['no game rows', []], ['one game row dropped', gameRows.filter((_: any, k: number) => k !== dropped)]] as const) {
            state.games = rows as any[];
            const { astro } = fakeAstro(`/nba/players/${PID}`, String(PID));
            const r = await prepareNbaPlayer(astro);
            state.games = null;
            if ('notFound' in r || 'unavailable' in r) throw new Error('expected params');
            expect(r.explorer.games, label).toBeNull();
        }
    });
});
