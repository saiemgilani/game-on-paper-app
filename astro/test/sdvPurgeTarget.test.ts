import { describe, expect, test, vi } from 'vitest';

// sdvPurgeTarget watches the football schemas only: the purge clears the football summary
// pages' tags, and a basketball ingest (nba_stats, wnba_stats, mbb, wbb) must not clear them.
const datasets = {
    'cfb.team_summaries': '2026-11-09T01:00:00Z',
    'nfl.team_summaries': '2026-11-09T01:00:00Z',
    'nba_stats.shot_player_games': '2026-11-09T01:00:00Z',
    'wbb.shot_player_games': '2026-11-09T01:00:00Z',
};
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async () => new Response(JSON.stringify({ datasets }), { status: 200, headers: { 'content-type': 'application/json' } }),
}));

describe('sdvPurgeTarget', () => {
    const now = Date.parse('2026-11-09T02:00:00Z');
    test('a settled football ingest is a target; basketball tables never are', async () => {
        const { sdvPurgeTarget } = await import('../src/resources/sdv');
        expect(await sdvPurgeTarget({}, now)).toEqual({
            'cfb.team_summaries': '2026-11-09T01:00:00Z',
            'nfl.team_summaries': '2026-11-09T01:00:00Z',
        });
    });
    test('with football already purged, a new basketball ingest purges nothing', async () => {
        const { sdvPurgeTarget } = await import('../src/resources/sdv');
        const purged = { 'cfb.team_summaries': '2026-11-09T01:00:00Z', 'nfl.team_summaries': '2026-11-09T01:00:00Z' };
        expect(await sdvPurgeTarget(purged, now)).toBeUndefined();
    });
});
