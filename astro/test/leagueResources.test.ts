import { beforeEach, describe, expect, test, vi } from 'vitest';

// The three resource modules take a trailing `league` that defaults to cfb.
// These pin (a) the cfb URLs are byte-identical to before, (b) nfl reaches the
// nfl Python route and ESPN paths, (c) the SDV client is inert for a league
// whose tables don't exist yet -- a 404 there must never cost a render.
const seen: string[] = [];
const fakeProcessed = {
    plays: [{ id: '1', scoringPlay: false }],
    advBoxScore: {},
    teamInfo: { home: { id: '7' }, away: { id: '13' } },
};
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        seen.push(String(url));
        return new Response(JSON.stringify(fakeProcessed), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

beforeEach(() => { seen.length = 0; });

describe('python.ts routes by league', () => {
    test('cfb is unchanged, nfl hits /nfl/<id>/process', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        await retrieveProcessedGame(1, 30).catch(() => {});
        await retrieveProcessedGame(2, 30, null, 'nfl').catch(() => {});
        expect(seen.some(u => u.endsWith('/cfb/1/process'))).toBe(true);
        expect(seen.some(u => u.endsWith('/nfl/2/process'))).toBe(true);
    });
});

describe('espn.ts routes by league', () => {
    test('game page and schedule URLs use the league slug', async () => {
        const espn = await import('../src/resources/espn');
        await espn.retrieveGamePage(3).catch(() => {});
        await espn.retrieveGamePage(4, 'nfl').catch(() => {});
        await espn.getRemoteGames(2025, 2, 10, undefined, 'nfl').catch(() => {});
        await espn.getRemoteGames(2025, 2, 10).catch(() => {});
        expect(seen.find(u => u.includes('gameId=3'))).toContain('/core/college-football/playbyplay');
        expect(seen.find(u => u.includes('gameId=4'))).toContain('/core/nfl/playbyplay');
        const nflSched = seen.find(u => u.includes('/core/nfl/schedule'))!;
        expect(nflSched).toBeTruthy();
        expect(nflSched).not.toContain('group=');
        expect(nflSched).toContain('week=10');
        // cfb: no explicit group means no group param either (unchanged behaviour)
        expect(seen.find(u => u.includes('/core/college-football/schedule'))).toBeTruthy();
    });
    test('a negative cfb group falls back to FBS, and nfl ignores group entirely', async () => {
        const espn = await import('../src/resources/espn');
        await espn.getRemoteGames(2025, 2, 1, -1).catch(() => {});
        await espn.getRemoteGames(2025, 2, 1, 8, 'nfl').catch(() => {});
        expect(seen.find(u => u.includes('college-football/schedule'))).toContain('group=80');
        expect(seen.find(u => u.includes('/nfl/schedule'))).not.toContain('group=');
    });
});

describe('sdv.ts is inert for a league without tables', () => {
    test('nfl returns empties without a request', async () => {
        const sdv = await import('../src/resources/sdv');
        expect(await sdv.retrievePercentiles(2025, 50, 2025, 'nfl')).toEqual([]);
        expect(await sdv.retrieveTeamSummaries({ season: 2025, league: 'nfl' })).toEqual([]);
        expect(await sdv.retrievePlayerSummaries(2025, sdv.SummaryType.PASSING, null, 'plays', false, 10, 2025, 'nfl')).toEqual([]);
        expect(await sdv.retrieveTeam(7, 'nfl')).toBeNull();
        expect(await sdv.retrieveTeamGames({ season: 2025, home_id: 7, league: 'nfl' })).toEqual([]);
        expect(seen.filter(u => u.includes('sportsdataverse.org'))).toEqual([]);
    });
});
