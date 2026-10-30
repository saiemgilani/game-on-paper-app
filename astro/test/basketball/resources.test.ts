// astro/test/basketball/resources.test.ts
import { describe, expect, test, vi } from 'vitest';

const calls: { rows: unknown[][]; from: unknown[][]; proc: unknown[][] } = { rows: [], from: [], proc: [] };
vi.mock('../../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/sdv')>()),
    retrieveRows: async (...a: unknown[]) => { calls.rows.push(a); return []; },
    retrieveRowsFrom: async (...a: unknown[]) => { calls.from.push(a); return [{ status_type_completed: false }]; },
}));
vi.mock('../../src/resources/python', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/python')>()),
    requestProcessor: async (...a: unknown[]) => { calls.proc.push(a); return JSON.stringify({ plays: [] }); },
}));

describe('resources read from the league config (NBA values unchanged)', () => {
    test('games: the nba games source, the nba processor path, the NBA id message', async () => {
        const { retrieveNbaProcessedGame, retrieveNbaSchedule } = await import('../../src/resources/nbaGames');
        const { BASKETBALL } = await import('../../src/basketball/config');
        await retrieveNbaSchedule('401766458', 'nba');
        expect(calls.from.at(-1)![0]).toBe(BASKETBALL.nba.gamesSource);
        await retrieveNbaProcessedGame('401766458', 30, 'nba');
        await retrieveNbaProcessedGame('401766458', 30, 'nba');
        expect(calls.proc.map((c) => c[0])).toEqual(['nba/401766458/process', 'nba/401766458/process']);
        await expect(retrieveNbaSchedule('12', 'nba')).rejects.toThrow('invalid NBA game id: "12"');
    });
    test("shots: league 'nba', the '002%' filter, the same query key order as before", async () => {
        const s = await import('../../src/resources/nbaShots');
        await s.retrievePlayerShots(2026, 1629008, 'nba');
        await s.retrieveTeamShots(2026, 1610612751, 'nba');
        await s.retrieveSeasonPlayerRows(2026, 'nba');
        const [player, team, season] = calls.rows.slice(-3);
        expect(player[0]).toBe('nba');
        expect(Object.keys(player[2] as object)).toEqual(['season', 'person_id', 'game_id__like', 'select', 'limit']);
        expect((player[2] as any).game_id__like).toBe('002%');
        expect(Object.keys(team[2] as object)).toEqual(['season', 'team_id', 'game_id__like', 'select', 'limit']);
        expect([season[0], season[1]]).toEqual(['nba', 'shot_season_players']);
    });
});
