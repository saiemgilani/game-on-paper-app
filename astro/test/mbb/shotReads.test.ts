// astro/test/mbb/shotReads.test.ts
// The college reads ask plan #7's tables; the NBA's queries are exactly what they were (key order is the KV cache key).
import { describe, expect, test, vi } from 'vitest';

const calls: unknown[][] = [];
vi.mock('../../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/sdv')>()),
    retrieveRows: async (...a: unknown[]) => { calls.push(a); return []; },
}));
const keys = (c: unknown[]) => Object.keys(c[2] as object);

describe('shot reads by league', () => {
    test('mbb: shot_rows, no game-id prefix (regular season + postseason, D23)', async () => {
        const s = await import('../../src/resources/nbaShots');
        await s.retrievePlayerShots(2026, 4433134, 'mbb');
        await s.retrieveTeamShots(2026, 251, 'mbb');
        const [player, team] = calls.slice(-2);
        expect([player[0], player[1], team[0], team[1]]).toEqual(['mbb', 'shot_rows', 'mbb', 'shot_rows']);
        expect(keys(player)).toEqual(['season', 'person_id', 'select', 'limit']);
        expect(keys(team)).toEqual(['season', 'team_id', 'select', 'limit']);
        expect((team[2] as any).select).toBe('game_id,x_legacy,y_legacy,shot_distance,shot_value,shot_result');
    });
    test('nba and wnba: shots, their prefix, the same key order as before', async () => {
        const s = await import('../../src/resources/nbaShots');
        await s.retrievePlayerShots(2026, 1629008, 'nba');
        await s.retrieveTeamShots(2026, 1611661328, 'wnba');
        const [nba, wnba] = calls.slice(-2);
        expect([nba[1], keys(nba), (nba[2] as any).game_id__like]).toEqual(['shots', ['season', 'person_id', 'game_id__like', 'select', 'limit'], '002%']);
        expect([wnba[1], (wnba[2] as any).game_id__like]).toEqual(['shots', '102%']);
    });
    test('coverage and conferences: one small read each, in the league schema', async () => {
        const s = await import('../../src/resources/nbaShots');
        await s.retrieveCoverageRows('mbb');
        expect(calls.at(-1)!.slice(0, 3)).toEqual(['mbb', 'shot_coverage', { limit: '50000' }]);
        await s.retrieveConferenceRows(2026, 'mbb');
        const [teams, groups] = calls.slice(-2);
        expect(teams.slice(0, 3)).toEqual(['mbb', 'team_group_seasons', { season: '2026', select: 'team_id,conference_id', limit: '50000' }]);
        expect(groups.slice(0, 3)).toEqual(['mbb', 'group_seasons', { season: '2026', level: 'conference', select: 'group_id,short_name', limit: '50000' }]);
    });
});
