// astro/test/wbb/shotReads.test.ts
// The WBB reads ask plan #7's wbb tables with the college query shape (no game-id prefix: regular season + postseason, D23).
import { describe, expect, test, vi } from 'vitest';

const calls: unknown[][] = [];
vi.mock('../../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/sdv')>()),
    retrieveRows: async (...a: unknown[]) => { calls.push(a); return []; },
}));
const keys = (c: unknown[]) => Object.keys(c[2] as object);

describe('wbb shot reads', () => {
    test('shot_rows in the wbb schema, the same keys as the men', async () => {
        const s = await import('../../src/resources/nbaShots');
        await s.retrievePlayerShots(2026, 5106164, 'wbb');
        await s.retrieveTeamShots(2026, 2579, 'wbb');
        await s.retrieveTeamShots(2026, 251, 'mbb');
        const [player, team, men] = calls.slice(-3);
        expect([player[0], player[1], team[0], team[1]]).toEqual(['wbb', 'shot_rows', 'wbb', 'shot_rows']);
        expect(keys(player)).toEqual(['season', 'person_id', 'select', 'limit']);
        expect([keys(team), team[2]]).toEqual([keys(men), { ...(men[2] as object), team_id: '2579' }]);
        expect((team[2] as any).game_id__like).toBeUndefined();
    });
    test('coverage and conferences: one small read each, in the wbb schema', async () => {
        const s = await import('../../src/resources/nbaShots');
        await s.retrieveCoverageRows('wbb');
        expect(calls.at(-1)!.slice(0, 3)).toEqual(['wbb', 'shot_coverage', { limit: '50000' }]);
        await s.retrieveConferenceRows(2026, 'wbb');
        const [teams, groups] = calls.slice(-2);
        expect(teams.slice(0, 3)).toEqual(['wbb', 'team_group_seasons', { season: '2026', select: 'team_id,conference_id', limit: '50000' }]);
        expect(groups.slice(0, 3)).toEqual(['wbb', 'group_seasons', { season: '2026', level: 'conference', select: 'group_id,short_name', limit: '50000' }]);
    });
});
