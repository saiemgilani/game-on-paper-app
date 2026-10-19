// astro/test/mbb/leaders.test.ts
// D26: the college leaders read two small requests, never the season; boards are 5- and 10-game windows inside the read;
// "Most improved" compares with the season line from the season rows, not with the 49-day read.
import { describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { seasonLinesFromRows, seasonPlayerGamesFromRows } from '../../src/nba/adapters';
import { lineOf } from '../../src/nba/data/aggregate';
import { leaderBoards } from '../../src/nba/data/leaders';
import { coverage, leadersGames2026, leadersLatest2026, seasonPlayers, windowRows } from './dashboardFixtures';

const latest = leadersLatest2026()[0].game_date;
// R-P4: the read is the latest date and the 48 before it (49 dates inclusive): latest - (days - 1)
const since = new Date(Date.parse(`${latest}T00:00:00Z`) - 48 * 864e5).toISOString().slice(0, 10);
const bars = BASKETBALL.mbb.leaderBars(2026);
const reads: { fn: string; args: unknown[] }[] = [];
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => seasonPlayers(2026),
    retrieveCoverageRows: async () => coverage(),
    retrieveLatestGameDate: async (...args: unknown[]) => { reads.push({ fn: 'latest', args }); return latest; },
    retrieveSeasonPlayerGameRows: async (...args: unknown[]) => { reads.push({ fn: 'games', args }); return leadersGames2026(); },
}));
const fakeAstro = (path: string) => ({ params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;

describe('the college leaders loader', () => {
    test('the latest date, then the 49-day read; never a season-wide read', async () => {
        const { prepareBasketballLeaders } = await import('../../src/routes/basketball/leaders');
        const r: any = await prepareBasketballLeaders(fakeAstro('/mbb/leaders'), 'mbb');
        expect(reads.map((x) => x.fn)).toEqual(['latest', 'games']);
        expect(reads[0].args.slice(0, 2)).toEqual([2026, 'mbb']);
        expect(since).toBe('2026-02-17'); // 2026-04-06 minus 48 days
        expect(reads[1].args).toEqual([2026, 'mbb', since]);
        expect(r.windows).toEqual([5, 10]);
        expect(Object.keys(r.boards).map(Number)).toEqual([5, 10]);
        expect(r.windowNote).toBe(' Windows count games from Feb 17 on: the last 49 days of games.');
    });
    test('every ranked window lies inside the read; Most improved uses the season line', () => {
        const players = seasonPlayers(2026);
        const placed = seasonPlayerGamesFromRows(leadersGames2026(), players);
        const lines = seasonLinesFromRows(players);
        const boards = leaderBoards(placed, null, 15, bars, { windows: [5, 10], seasonLines: lines });
        for (const n of [5, 10] as const) for (const m of ['fgPct', 'efgPct', 'fg3Pct', 'improved'] as const) {
            for (const row of boards[n][m].rows) expect(row.window.from >= since, `${n} ${m} ${row.person_id}`).toBe(true);
        }
        const top = boards[10].improved.rows[0];
        expect(top.seasonEfg).toBe(lineOf(lines.get(top.person_id)!).efgPct);
        const p = players.filter((x) => x.person_id === top.person_id);
        expect(lines.get(top.person_id)!.attempts).toBe(p.reduce((a, x) => a + x.attempts, 0));
    });
    test('without options the boards are the NBA ones: every window, season eFG from the games', () => {
        const placed = seasonPlayerGamesFromRows(leadersGames2026(), seasonPlayers(2026));
        const plain = leaderBoards(placed, null, 15, bars);
        expect(Object.keys(plain).map(Number)).toEqual([5, 10, 20]);
        expect(leaderBoards(placed, null, 15, bars, {})).toEqual(plain);
    });
    test('the cap: the configured window is the measured one, under 50,000 rows in every season', () => {
        expect(BASKETBALL.mbb.leadersRead!.days).toBe(49);
        for (const r of windowRows()) expect(r.max49, String(r.season)).toBeLessThan(50000);
        expect(leadersGames2026().length).toBeLessThan(50000);
    });
});

describe('the reads', () => {
    test('latest date and the restricted read; the NBA season read unchanged', async () => {
        vi.resetModules();
        const calls: unknown[][] = [];
        vi.doMock('../../src/resources/sdv', async () => ({
            ...(await vi.importActual<typeof import('../../src/resources/sdv')>('../../src/resources/sdv')),
            retrieveRows: async (...a: unknown[]) => { calls.push(a); return [{ game_date: '2026-04-06' }]; },
        }));
        const s = await vi.importActual<typeof import('../../src/resources/nbaShots')>('../../src/resources/nbaShots');
        expect(await s.retrieveLatestGameDate(2026, 'mbb')).toBe('2026-04-06');
        await s.retrieveSeasonPlayerGameRows(2026, 'mbb', '2026-02-17');
        await s.retrieveSeasonPlayerGameRows(2026, 'nba');
        expect(calls.map((c) => c.slice(0, 3))).toEqual([
            ['mbb', 'shot_player_games', { season: '2026', select: 'game_date', order: '-game_date', limit: '1' }],
            ['mbb', 'shot_player_games', { season: '2026', game_date__gte: '2026-02-17', limit: '50000' }],
            ['nba', 'shot_player_games', { season: '2026', limit: '50000' }],
        ]);
        vi.doUnmock('../../src/resources/sdv');
    });
});
