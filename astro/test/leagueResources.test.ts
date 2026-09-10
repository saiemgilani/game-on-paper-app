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

describe('sdv.ts routes each league to its own API base', () => {
    test('nfl season-table reads hit /v1/nfl with a namespaced cache key, cfb is unchanged', async () => {
        const sdv = await import('../src/resources/sdv');
        await sdv.retrieveTeamSummaries({ season: 2025, league: 'nfl' }).catch(() => {});
        await sdv.retrievePercentiles(2025, 50, 2025, 'nfl').catch(() => {});
        await sdv.retrievePlayerSummaries(2025, sdv.SummaryType.PASSING, null, 'plays', false, 10, 2025, 'nfl').catch(() => {});
        await sdv.retrieveTeamSummaries({ season: 2025 }).catch(() => {});
        const urls = seen.filter(u => u.includes('sportsdataverse.org'));
        expect(urls.find(u => u.includes('/v1/nfl/team_summaries?'))).toContain('season=2025');
        expect(urls.some(u => u.includes('/v1/nfl/percentiles?'))).toBe(true);
        expect(urls.some(u => u.includes('/v1/nfl/passing?'))).toBe(true);
        expect(urls.some(u => u.includes('/v1/cfb/team_summaries?'))).toBe(true);
        // nfl rows never ask for the college-only FBS filter
        expect(urls.filter(u => u.includes('/v1/nfl/')).every(u => !u.includes('fbs_class='))).toBe(true);
    });

    test('a no-category team read selects only the columns its league has', async () => {
        const sdv = await import('../src/resources/sdv');
        await sdv.retrieveTeamSummaries({ team_id: 59 }).catch(() => {});
        await sdv.retrieveTeamSummaries({ team_id: 12, league: 'nfl' }).catch(() => {});
        const sel = (u: string) => decodeURIComponent(new URL(u).searchParams.get('select') ?? '').split(',');
        const cfb = sel(seen.find(u => u.includes('/v1/cfb/team_summaries?'))!);
        const nfl = sel(seen.find(u => u.includes('/v1/nfl/team_summaries?'))!);
        // the rbsdm columns exist in nfl.team_summaries only; asking cfb for one is a 400
        expect(cfb).not.toContain('pass_oe_off');
        expect(cfb).not.toContain('luck_opp_fg_pct_def_rank');
        expect(cfb).toContain('net_adj_epa');
        expect(nfl).toContain('pass_oe_off');
        expect(nfl).toContain('net_adj_epa');
    });
});
