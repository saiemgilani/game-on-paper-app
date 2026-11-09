// astro/test/wbb/membership.test.ts
// D38 + D43/D47 beyond the index: team pages answer 200 for every member of the season (empty when no shot is linked) and 404
// otherwise; the committed current-season member table is plan #9's rule over the 2026 captures.
import { describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { withSeasonMembers } from '../../src/basketball/dashboards';
import { WBB_MEMBERS_2026 } from '../../src/nba/data/wbbMembers';
import { teamsFromSeasonRows } from '../../src/nba/tables';
import { NOLA, conferenceNames, conferences, coverage, leagueContext, nolaShots2026, scheduleTeams, seasonPlayers, type Season } from './dashboardFixtures';

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number) => ([2019, 2022, 2026].includes(s) ? seasonPlayers(s as Season) : []),
    retrieveLeagueContextRows: async () => leagueContext(2026),
    // 2697 and 42 (no 2026 conference row) get shot rows too, so the 404 below holds WITH shots, not for want of them
    // (self-review on #344: R-S14 dropped the player-row requirement, leaving membership the only guard)
    retrieveTeamShots: async (s: number, t: number) => (s === 2026 && [NOLA, 2697, 42].includes(t) ? nolaShots2026() : []),
    retrieveCoverageRows: async () => coverage(),
    retrieveConferenceRows: async (s: number) => ({ teams: conferences(s as Season), groups: conferenceNames(s as Season) }),
    retrieveScheduleTeamRows: async (s: number) => scheduleTeams(s as Season),
}));
const fakeAstro = (path: string, id: string) =>
    ({ params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;

describe('the current-season member table (plan #9 currentMembers)', () => {
    test('WBB_MEMBERS_2026 is withSeasonMembers over the 2026 captures: 363, the six reclassifiers in, 2697 and 42 out', () => {
        const rule = withSeasonMembers(teamsFromSeasonRows(seasonPlayers(2026), 2026, 'wbb'), conferences(2026), scheduleTeams(2026), 2026, 'wbb').map((t) => t.team_id).sort((a, b) => a - b);
        expect([...WBB_MEMBERS_2026]).toEqual(rule);
        expect(WBB_MEMBERS_2026).toHaveLength(363);
        for (const id of [88, 284, 2330, 2511, 2815, 2837]) expect(WBB_MEMBERS_2026, String(id)).toContain(id);
        for (const id of [2697, 42]) expect(WBB_MEMBERS_2026, String(id)).not.toContain(id);
        expect(BASKETBALL.wbb.currentMembers).toEqual({ season: 2026, ids: WBB_MEMBERS_2026 });
        for (const lg of ['nba', 'wnba'] as const) expect(Object.keys(BASKETBALL[lg]), lg).not.toContain('currentMembers');
    });
});

describe('team pages for every member of the season', () => {
    test('the four unlinked programs and a reclassifier: 200 empty pages in 2025-26', async () => {
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        for (const id of [2130, 2385, 2441, 2837]) {
            const r: any = await prepareBasketballTeam(fakeAstro(`/wbb/team/${id}`, String(id)), 'wbb');
            expect([r.empty, r.team?.team_id], String(id)).toEqual([true, id]);
        }
    });
    test('R-S14: New Orleans 2443 (992 placed shots, no season-player row) is the dashboard with no roster, not the empty page', async () => {
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const r: any = await prepareBasketballTeam(fakeAstro(`/wbb/team/${NOLA}`, String(NOLA)), 'wbb');
        expect([r.empty, r.noPlayers, r.team?.team_id, r.roster, r.line.attempts, r.dashboard === null]).toEqual([undefined, true, NOLA, [], 992, false]);
    });
    test("R-S14 on the index: New Orleans's line is its team page's (992 FGA), not a dash (self-review on #344)", async () => {
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        expect(seasonPlayers(2026).some((r) => r.team_id === NOLA)).toBe(false);
        const index: any = await prepareBasketballTeams(fakeAstro('/wbb/teams', ''), 'wbb');
        const page: any = await prepareBasketballTeam(fakeAstro(`/wbb/team/${NOLA}`, String(NOLA)), 'wbb');
        expect(index.lines.get(NOLA)).toEqual(page.line);
        expect(index.lines.get(NOLA).attempts).toBe(992);
        for (const id of [2697, 42]) expect(index.lines.has(id), String(id)).toBe(false); // non-members: no read, no row
    });
    test('without a conference row that season a program is a 404 (D43), even with shot rows', async () => {
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        for (const id of [2697, 42]) expect(await prepareBasketballTeam(fakeAstro(`/wbb/team/${id}`, String(id)), 'wbb'), String(id)).toEqual({ notFound: true });
        expect(await prepareBasketballTeam(fakeAstro('/wbb/team/112358?season=2019', '112358'), 'wbb')).toEqual({ notFound: true });
        const liuBrooklyn: any = await prepareBasketballTeam(fakeAstro('/wbb/team/2341?season=2019', '2341'), 'wbb');
        expect([liuBrooklyn.empty, liuBrooklyn.team?.team_id]).toEqual([true, 2341]);
    });
});
