// astro/test/mbb/memberSeasons.test.ts
// Ruling R-P11: a college team's season picker (team page) and the players page's ?team= carry follow its member seasons
// (D43/D47, R7), a table generated from the warehouse by the same rule; R-P12: a failed membership read is the 503; review
// minors: membership is checked when the team has shots too, the index copy says "with linked shots", an empty college season
// still asks for a team.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { withSeasonMembers } from '../../src/basketball/dashboards';
import NbaPlayersRoute from '../../src/components/routes/NbaPlayersRoute.astro';
import NbaTeamsRoute from '../../src/components/routes/NbaTeamsRoute.astro';
import { MBB_MEMBER_SEASONS, MBB_MEMBER_SEASONS_THROUGH } from '../../src/nba/data/mbbMemberSeasons';
import { MBB_LAST_KNOWN_SEASON } from '../../src/nba/seasonRange';
import { TEX, conferenceNames, conferences, coverage, leagueContext, scheduleTeams, seasonPlayers, texShots } from './dashboardFixtures';

const state = vi.hoisted(() => ({ dropTex: false, dropTexPlayers: false, failMembership: false, emptySeason: false }));
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number) => (state.emptySeason ? [] : seasonPlayers(s as 2019 | 2023 | 2026).filter((r) => !(state.dropTexPlayers && r.team_id === TEX))),
    retrieveLeagueContextRows: async () => leagueContext(2026),
    retrieveTeamShots: async (s: number, id: number) => (id === TEX ? texShots(s as 2019 | 2026) : []),
    retrieveCoverageRows: async () => coverage(),
    retrieveConferenceRows: async (s: number) => {
        if (state.failMembership) throw new Error('down');
        const teams = conferences(s as 2019 | 2021 | 2026).filter((r) => !(state.dropTex && r.team_id === String(TEX)));
        return { teams, groups: s === 2021 ? [] : conferenceNames(s as 2019 | 2026) };
    },
    retrieveScheduleTeamRows: async (s: number) => scheduleTeams(s as 2019 | 2021 | 2026),
}));
const fakeAstro = (path: string, params: Record<string, string> = {}) => {
    const cache: unknown[] = [];
    return { cache, a: { params, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any };
};
const STMN = 2900; // St. Thomas (mbbTeams.ts): Division I from 2021-22
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { Object.assign(state, { dropTex: false, dropTexPlayers: false, failMembership: false, emptySeason: false }); });

describe('the member-seasons table (R-P11)', () => {
    test('2019, 2021 and 2026 re-derive from the committed captures by the same rule', () => {
        for (const s of [2019, 2021, 2026] as const) {
            const played = new Set(scheduleTeams(s).flatMap((g) => [g.home_id, g.away_id]).filter((x) => x != null).map(Number));
            const rule = [...new Set(conferences(s).filter((r) => /^\d+$/.test(r.team_id)).map((r) => Number(r.team_id)))].filter((id) => played.has(id)).sort((a, b) => a - b);
            const table = [...MBB_MEMBER_SEASONS].filter(([, ss]) => ss.includes(s)).map(([id]) => id).sort((a, b) => a - b);
            expect(table, String(s)).toEqual(rule);
            expect(withSeasonMembers([], conferences(s), scheduleTeams(s), s, 'mbb').map((t) => t.team_id).sort((a, b) => a - b), String(s)).toEqual(rule);
        }
        expect(MBB_MEMBER_SEASONS_THROUGH).toBe(2026);
    });
    test('the season rollover moves together: currentMembers, the member table and MBB_LAST_KNOWN_SEASON agree (review Important 1)', () => {
        const m = BASKETBALL.mbb;
        expect([m.currentMembers!.season, m.memberSeasons!.through]).toEqual([MBB_LAST_KNOWN_SEASON, MBB_LAST_KNOWN_SEASON]);
        const last = [...MBB_MEMBER_SEASONS].filter(([, ss]) => ss.includes(MBB_LAST_KNOWN_SEASON)).map(([id]) => id).sort((a, b) => a - b);
        expect([...m.currentMembers!.ids].sort((a, b) => a - b)).toEqual(last);
    });
    test('St. Thomas lists only its member seasons on its team page', async () => {
        expect(MBB_MEMBER_SEASONS.get(STMN)).toEqual([2022, 2023, 2024, 2025, 2026]);
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const r: any = await prepareBasketballTeam(fakeAstro(`/mbb/team/${STMN}`, { id: String(STMN) }).a, 'mbb');
        expect(r.seasons).toEqual([2022, 2023, 2024, 2025, 2026]);
        const tex: any = await prepareBasketballTeam(fakeAstro(`/mbb/team/${TEX}`, { id: String(TEX) }).a, 'mbb');
        expect([...tex.seasons].sort()).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    });
    test('the players page carries ?team=<St. Thomas> only into its member seasons', async () => {
        const { prepareBasketballPlayers } = await import('../../src/routes/basketball/players');
        const data: any = await prepareBasketballPlayers(fakeAstro(`/mbb/players?team=${STMN}`).a, 'mbb');
        expect(data.selected.team_id).toBe(STMN);
        const html = await container.renderToString(NbaPlayersRoute, { props: { data }, locals: { league: 'mbb' } as App.Locals });
        const opts = [...html.matchAll(/<option value="(\/mbb\/players[^"]*)"[^>]*>(\d{4}-\d{2})</g)].map((m) => m[1].replace(/&amp;/g, '&'));
        expect(opts).toHaveLength(8);
        for (const s of [2019, 2020, 2021]) expect(opts).toContain(`/mbb/players?season=${s}`);
        for (const s of [2022, 2023, 2024, 2025]) expect(opts).toContain(`/mbb/players?team=${STMN}&season=${s}`);
        expect(opts).toContain(`/mbb/players?team=${STMN}`);
    });
});

describe('/mbb/team/<id>: membership with or without shots', () => {
    test('Texas 2026 with shots is a member: the dashboard page', async () => {
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const r: any = await prepareBasketballTeam(fakeAstro(`/mbb/team/${TEX}`, { id: String(TEX) }).a, 'mbb');
        expect([r.team.team_id, r.empty, r.dashboard === null, r.line.attempts]).toEqual([TEX, undefined, false, texShots(2026).length]);
    });
    // Self-review on #344: R-S14 (made for WBB's New Orleans) is in the shared route, so it changed MBB too. Mutation of the
    // real fixtures: Texas 2026 keeps its real shots and conference row but loses its season-player rows (MBB has no such
    // capture). Before R-S14 this was the empty "no shots linked" page; now the dashboard, no roster, and the index's line agrees.
    test("R-S14 in MBB: a member with linked shots but no season-player row is the dashboard with no roster", async () => {
        state.dropTexPlayers = true;
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const r: any = await prepareBasketballTeam(fakeAstro(`/mbb/team/${TEX}`, { id: String(TEX) }).a, 'mbb');
        expect([r.empty, r.noPlayers, r.team.team_id, r.roster, r.dashboard === null, r.line.attempts]).toEqual([undefined, true, TEX, [], false, texShots(2026).length]);
        const index: any = await prepareBasketballTeams(fakeAstro('/mbb/teams').a, 'mbb');
        expect(index.lines.get(TEX)).toEqual(r.line);
    });
    test('a team with shots but no conference row that season is a 404, as the index leaves it out (the real 2026 rows less Texas\'s)', async () => {
        state.dropTex = true;
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const f = fakeAstro(`/mbb/team/${TEX}`, { id: String(TEX) });
        expect(await prepareBasketballTeam(f.a, 'mbb')).toEqual({ notFound: true });
        expect(f.cache.at(-1)).toBe(false);
    });
    test('R-P12: a failed membership read is the unavailable page (503), uncacheable, never a 404', async () => {
        state.failMembership = true;
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        for (const id of [TEX, 85]) {
            const f = fakeAstro(`/mbb/team/${id}?season=2019`, { id: String(id) });
            expect(await prepareBasketballTeam(f.a, 'mbb'), String(id)).toEqual({ unavailable: true });
            expect(f.cache.at(-1)).toBe(false);
            expect(f.a.response.headers.get('Cache-Control')).toBe('no-store');
        }
    });
});

describe('college copy', () => {
    test('the index promises a shot chart and roster only for each team with linked shots', async () => {
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const data: any = await prepareBasketballTeams(fakeAstro('/mbb/teams').a, 'mbb');
        const html = await container.renderToString(NbaTeamsRoute, { props: { data }, locals: { league: 'mbb' } as App.Locals });
        expect(html).toContain('with a shot chart and roster for each team with linked shots.');
    });
    test('an empty college season with no team chosen still asks for a team, not "every team"', async () => {
        state.emptySeason = true;
        const { prepareBasketballPlayers } = await import('../../src/routes/basketball/players');
        const data: any = await prepareBasketballPlayers(fakeAstro('/mbb/players').a, 'mbb');
        expect([data.needsTeam, data.byId, data.rows.length, data.teams.length]).toEqual([true, true, 0, 0]);
        const html = await container.renderToString(NbaPlayersRoute, { props: { data }, locals: { league: 'mbb' } as App.Locals });
        expect(html).toContain('for the team you choose');
        expect(html).not.toContain('every team');
        expect(html).toContain('shots in 2025-26 yet.');
    });
});
