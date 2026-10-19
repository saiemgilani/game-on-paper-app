// astro/test/mbb/dashboardRoutes.test.ts
// The team and player loaders read the college tables and build with the season's NCAA court.
import { describe, expect, test, vi } from 'vitest';
import { courtFor } from '../../src/basketball/config';
import { TEX, leagueContext, p19, p26, player2019Games, player2026Games, player2026Seasons, player2026Shots, seasonPlayers, texShots } from './dashboardFixtures';

const lite = ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result }: any) => ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result });
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number, lg: string) => { if (lg !== 'mbb') throw new Error(lg); return seasonPlayers(s as 2019 | 2026); },
    retrieveLeagueContextRows: async (s: number) => leagueContext(s as 2019 | 2026),
    retrieveTeamShots: async (s: number, t: number) => (t === TEX ? texShots(s as 2019 | 2026).map(lite) : []),
    retrievePlayerShots: async () => player2026Shots(),
    retrievePlayerGameRows: async (s: number) => (s === 2026 ? player2026Games() : player2019Games()),
    retrievePlayerSeasons: async () => [...new Set(player2026Seasons().map((r) => Number(r.season)))].sort((a, b) => a - b),
    retrieveCoverageRows: async () => [],
    retrieveConferenceRows: async () => ({ teams: [], groups: [] }),
}));
const fakeAstro = (path: string, params: Record<string, string>) =>
    ({ params, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;

describe('the college dashboard loaders use the NCAA court', () => {
    test('team page, 2019 and 2026', async () => {
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        for (const season of [2019, 2026]) {
            const r: any = await prepareBasketballTeam(fakeAstro(`/mbb/team/${TEX}?season=${season}`, { id: String(TEX) }), 'mbb');
            expect(r.dashboard.hex.court, String(season)).toBe(courtFor('mbb', season));
            expect(r.line.attempts, String(season)).toBe(texShots(season as 2019 | 2026).length); // every placed shot, attributed or not
        }
    });
    test('player page, 2026', async () => {
        const { prepareBasketballPlayer } = await import('../../src/routes/basketball/player');
        const id = p26().person_id;
        const r: any = await prepareBasketballPlayer(fakeAstro(`/mbb/players/${id}`, { id: String(id) }), 'mbb');
        expect(r.explorer.court).toBe(courtFor('mbb', 2026));
        expect(r.hisSeasons.every((s: number) => s >= 2019)).toBe(true);
        expect(p19().team_id).toBe(TEX);
    });
});
