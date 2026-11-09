// astro/test/wnba/dashboardRoutes.test.ts
// The two dashboard loaders build with the season's court: the team page's server-built dashboard, the player page's
// explorer (the island rebuilds it in the browser from data.court).
import { describe, expect, test, vi } from 'vitest';
import { BASKETBALL, courtFor } from '../../src/basketball/config';
import { SEA, leagueContext, leagueShots2003, p03, player2003Games, seaShots, seasonPlayers } from './dashboardFixtures';

const lite = ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result }: any) => ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result });
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number, lg: string) => { if (lg !== 'wnba') throw new Error(lg); return seasonPlayers(s as 2003 | 2026); },
    retrieveLeagueContextRows: async (s: number) => leagueContext(s as 2003 | 2026),
    retrieveTeamShots: async (s: number, t: number) => (s === 2003 ? leagueShots2003().filter((r) => r.team_id === t).map(lite) : t === SEA ? seaShots(2026) : []),
    retrievePlayerShots: async (_s: number, id: number) => leagueShots2003().filter((r) => r.person_id === id).map(lite),
    retrievePlayerGameRows: async () => player2003Games(),
    retrievePlayerSeasons: async () => [2003],
}));
const fakeAstro = (path: string, params: Record<string, string>) =>
    ({ params, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;

describe('dashboard loaders pass the season court', () => {
    test('team page, 2003 and 2026', async () => {
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        for (const season of [2003, 2026]) {
            const r: any = await prepareBasketballTeam(fakeAstro(`/wnba/team/${SEA}?season=${season}`, { id: String(SEA) }), 'wnba');
            expect(r.dashboard.hex.court, String(season)).toBe(courtFor('wnba', season));
        }
    });
    test('player page, 2003', async () => {
        const { prepareBasketballPlayer } = await import('../../src/routes/basketball/player');
        const id = p03().person_id;
        const r: any = await prepareBasketballPlayer(fakeAstro(`/wnba/players/${id}?season=2003`, { id: String(id) }), 'wnba');
        expect(r.explorer.court).toBe(courtFor('wnba', 2003));
        expect(r.explorer.placeholder).toEqual(BASKETBALL.wnba.placeholderLocation);
        // 132 of her 526 2003 shots sit at the hoop centre (the real capture); seasonFgPct still counts all 526
        expect(r.unlocated).toEqual({ count: 132, total: 526 });
    });
});
