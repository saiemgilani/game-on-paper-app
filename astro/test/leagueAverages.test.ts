import { beforeEach, describe, expect, test, vi } from 'vitest';

// retrieveLeagueAverages goes through requestSDV -> wrappedFetch; the KV stub always misses.
const seen: string[] = [];
let body: unknown = { count: 0, data: [] };
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        seen.push(String(url));
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

beforeEach(() => { seen.length = 0; });

const ROWS = [
    { season: 2025, level: 'fbs', entity: 'player', category: 'passing', metric: 'EPAplay', mean: 0.15, median: 0.14, sd: 0.1, n: 98, qualifier_min: 14 },
    { season: 2025, level: 'p4', entity: 'player', category: 'passing', metric: 'EPAplay', mean: 0.2, median: 0.19, sd: 0.1, n: 50, qualifier_min: 14 },
    { season: 2025, level: 'fbs', entity: 'team', category: 'team_summaries', metric: 'EPAplay_off', mean: 0.05, median: 0.04, sd: 0.08, n: 136, qualifier_min: null },
];

describe('retrieveLeagueAverages', () => {
    test('reads /v1/{league}/league_averages with the season and the given filters only', async () => {
        body = { count: ROWS.length, data: ROWS };
        const { retrieveLeagueAverages } = await import('../src/resources/sdv');
        const rows = await retrieveLeagueAverages(2025, { entity: 'player', category: 'passing' }, 'nfl');
        const url = new URL(seen.find(u => u.includes('/league_averages'))!);
        expect(url.pathname).toBe('/v1/nfl/league_averages');
        expect(url.searchParams.get('season')).toBe('2025');
        expect(url.searchParams.get('entity')).toBe('player');
        expect(url.searchParams.get('category')).toBe('passing');
        expect(url.searchParams.has('level')).toBe(false);
        expect(rows).toHaveLength(3);
    });
});

describe('leagueAverageFor', () => {
    test('keys by category + metric within one level', async () => {
        const { indexLeagueAverages, leagueAverageFor } = await import('../src/utils/leagueAverages');
        const fbs = indexLeagueAverages(ROWS as any, 'fbs');
        expect(leagueAverageFor(fbs, 'passing', 'EPAplay')?.mean).toBe(0.15);
        expect(leagueAverageFor(fbs, 'team_summaries', 'EPAplay_off')?.n).toBe(136);
        expect(leagueAverageFor(indexLeagueAverages(ROWS as any, 'p4'), 'passing', 'EPAplay')?.n).toBe(50);
        expect(leagueAverageFor(fbs, 'passing', 'nope')).toBeUndefined();
    });
});
