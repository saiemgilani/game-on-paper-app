import { describe, expect, test, vi } from 'vitest';

// Audit C7, 2026-10-08: the team trend chart drew the single-GAME ladder
// (`percentiles`, p1/p25/p50/p75/p99 of team-games) behind a team's SEASON means.
// Season means are far more compressed: across 2014-2025, 83% of FBS offenses
// (EPA/play) sat inside the game p25-p75 box that should hold 50%, and in 2025 the
// season p99 (0.27) was half the game p99 (0.53), so every season looked average.
// Season-level bands would need every team-season of every trend metric (~2.3 MB
// for CFB), so the chart draws the team alone, with its trend line, as the Net
// view already did.
const sdv = vi.hoisted(() => ({ percentileCalls: 0 }));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string) => ({ id: String(id), location: 'Alabama', color: '000000' }),
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => { sdv.percentileCalls += 1; return [{ season: 2025, pctile: 0.5, EPAplay: 0.05 }]; },
    retrieveTeamSummaries: async () => [{ team_id: 333, season: 2025, EPAplay_off: 0.2 }],
}));

describe('team profile trend chart', () => {
    test('reads no team-game ladder to draw behind season means', async () => {
        const { loadTeamProfile } = await import('../src/routes/teamProfile');
        const astro: any = { params: { id: '333' }, locals: {}, cache: { set: () => {} } };
        const r: any = await loadTeamProfile(astro, 'cfb');
        expect(r.teamSummaries).toHaveLength(1);
        expect(sdv.percentileCalls).toBe(0);
        expect(r).not.toHaveProperty('percentiles');
    });
});
