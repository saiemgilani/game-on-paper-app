// astro/test/mbb/playersByTeam.test.ts
// College player lists are one team at a time, keyed by the ESPN team id: tricodes collide (SDSU, 2023).
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import NbaTeamSelect from '../../src/components/nba/NbaTeamSelect.astro';
import { teamsFromSeasonRows } from '../../src/nba/tables';
import { withSeasonMembers } from '../../src/basketball/dashboards';
import { TEX, conferences, coverage, leagueContext, scheduleTeams, seasonPlayers } from './dashboardFixtures';

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number) => seasonPlayers(s as 2019 | 2023 | 2026),
    retrieveLeagueContextRows: async () => leagueContext(2026),
    retrieveTeamShots: async () => [],
    retrieveCoverageRows: async () => coverage(),
    retrieveConferenceRows: async (s: number) => ({ teams: conferences(s as 2019 | 2021 | 2026), groups: [] }),
    retrieveScheduleTeamRows: async (s: number) => scheduleTeams(s as 2019 | 2021 | 2026),
}));
const fakeAstro = (path: string, params: Record<string, string> = {}) =>
    ({ params, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;

describe('/mbb/players', () => {
    test('no team: the pickers and a prompt, no table', async () => {
        const { prepareBasketballPlayers } = await import('../../src/routes/basketball/players');
        const r: any = await prepareBasketballPlayers(fakeAstro('/mbb/players'), 'mbb');
        expect([r.needsTeam, r.byId, r.team, r.rows.length, r.selected]).toEqual([true, true, '', 0, null]);
        expect(r.defaults).toEqual({ season: '2026', team: '' });
        expect(r.teams.length).toBe(new Set(seasonPlayers(2026).map((x) => x.team_id)).size);
    });
    test('?team=<ESPN id>: that team; 2023 SDSU is two teams', async () => {
        const { prepareBasketballPlayers } = await import('../../src/routes/basketball/players');
        const tex: any = await prepareBasketballPlayers(fakeAstro(`/mbb/players?team=${TEX}`), 'mbb');
        expect([tex.selected.team_id, tex.team]).toEqual([TEX, String(TEX)]);
        expect(tex.rows.length).toBe(seasonPlayers(2026).filter((x) => x.team_id === TEX).length);
        const a: any = await prepareBasketballPlayers(fakeAstro('/mbb/players?season=2023&team=21'), 'mbb');
        const b: any = await prepareBasketballPlayers(fakeAstro('/mbb/players?season=2023&team=2571'), 'mbb');
        expect([a.selected.tricode, b.selected.tricode]).toEqual(['SDSU', 'SDSU']);
        expect(a.selected.name).not.toBe(b.selected.name);
        expect(new Set(a.rows.map((x: any) => x.person_id))).not.toEqual(new Set(b.rows.map((x: any) => x.person_id)));
    });
    test('ALL, a tricode, an unknown id and junk are 404s', async () => {
        const { prepareBasketballPlayers } = await import('../../src/routes/basketball/players');
        for (const q of ['ALL', 'TEX', '999999', 'abc']) expect(await prepareBasketballPlayers(fakeAstro(`/mbb/players?team=${q}`), 'mbb'), q).toEqual({ notFound: true });
    });
    test('the by-id team select: no All teams, a prompt option, ids in the URLs', async () => {
        const container = await AstroContainer.create();
        const teams = teamsFromSeasonRows(seasonPlayers(2026), 2026, 'mbb');
        const html = await container.renderToString(NbaTeamSelect, { props: { teams, team: '', season: 2026, defaults: { season: '2026', team: '' }, byId: true }, locals: { league: 'mbb' } as App.Locals });
        expect(html).not.toContain('All teams');
        expect(html).toContain('>Choose a team</option>');
        expect(html).toContain(`value="/mbb/players?team=${TEX}"`);
    });
});

describe('/mbb/team/<id>: membership decides (D43, D47, D48)', () => {
    test('Hartford (42) is in ESPN\'s 2026 D-I list (D34) but has no 2026 conference row: a 404', async () => {
        expect(BASKETBALL.mbb.teams.all.some((t) => t.team_id === 42)).toBe(true);
        expect(conferences(2026).some((r) => r.team_id === '42')).toBe(false);
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        expect(await prepareBasketballTeam(fakeAstro('/mbb/team/42', { id: '42' }), 'mbb')).toEqual({ notFound: true });
    });
    test('a season member with no linked shot is a 200 page that says so (the first such 2019 member Task 2 Step 4 printed)', async () => {
        const shotTeams = new Set(seasonPlayers(2019).map((x) => x.team_id));
        const m = withSeasonMembers([], conferences(2019), scheduleTeams(2019), 2019, 'mbb').find((t) => !shotTeams.has(t.team_id));
        expect(m, 'Task 2 Step 4 printed a 2019 member without linked shots').toBeDefined();
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const r: any = await prepareBasketballTeam(fakeAstro(`/mbb/team/${m!.team_id}?season=2019`, { id: String(m!.team_id) }), 'mbb');
        expect([r.empty, r.dashboard, r.roster, r.team.team_id]).toEqual([true, null, [], m!.team_id]);
    });
    test('an id that is no D-I member that season is still a 404', async () => {
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        expect(await prepareBasketballTeam(fakeAstro('/mbb/team/2476', { id: '2476' }), 'mbb')).toEqual({ notFound: true }); // Oglethorpe, non-D-I
    });
});
