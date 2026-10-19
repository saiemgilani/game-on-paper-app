// astro/test/mbb/teamsIndex.test.ts
// The college teams index: the season's teams with shots, grouped by their conference that season (sdv-reference-data via
// the Data API), searchable with the existing name filter.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { conferenceGroups, withSeasonMembers } from '../../src/basketball/dashboards';
import NbaConferenceTeams from '../../src/components/nba/NbaConferenceTeams.astro';
import { teamLinesFromRows, teamsFromSeasonRows } from '../../src/nba/tables';
import { TEX, conferenceNames, conferences, coverage, scheduleTeams, seasonPlayers } from './dashboardFixtures';

// the index lists the season's members (D43/D47, R7), grouped by their conference that season
const membersOf = (season: 2019 | 2026) => withSeasonMembers(teamsFromSeasonRows(seasonPlayers(season), season, 'mbb'), conferences(season), scheduleTeams(season), season, 'mbb');
const groupsOf = (season: 2019 | 2026) => conferenceGroups(membersOf(season), conferences(season), conferenceNames(season));
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

describe('teams by conference', () => {
    test('2026: the 365 members, each in exactly one named conference, A to Z; Texas in the SEC; Hartford not listed', () => {
        const g = groupsOf(2026);
        const ids = g.flatMap((x) => x.teams.map((t) => t.team_id));
        expect(ids.length).toBe(365);
        expect(ids).not.toContain(42);
        expect(new Set(ids).size).toBe(ids.length);
        expect(g.some((x) => x.id === '')).toBe(false); // every 2026 team has a conference row (Task 2's fixture test)
        expect(g.every((x) => !x.label.startsWith('mbb:'))).toBe(true);
        expect(g.map((x) => x.label)).toEqual([...g.map((x) => x.label)].sort((a, b) => a.localeCompare(b)));
        expect(g.find((x) => x.teams.some((t) => t.team_id === TEX))!.label).toBe('SEC');
        for (const x of g) expect(x.teams.map((t) => t.name)).toEqual([...x.teams.map((t) => t.name)].sort((a, b) => a.localeCompare(b)));
    });
    test('2019 groups by 2019 membership (realignment is per season)', () => {
        const g = groupsOf(2019);
        expect(g.find((x) => x.teams.some((t) => t.team_id === TEX))!.label).toBe('Big 12');
    });
    test('a team without a conference row goes last under "Other Division I"; a non-numeric reference id is dropped', () => {
        const teams = teamsFromSeasonRows(seasonPlayers(2026), 2026, 'mbb');
        const rows = conferences(2026).filter((r) => r.team_id !== String(TEX)).concat([{ team_id: 'x9', conference_id: 'mbb:sec' }]);
        const g = conferenceGroups(teams, rows, conferenceNames(2026));
        expect(g.at(-1)).toMatchObject({ id: '', label: 'Other Division I' });
        expect(g.at(-1)!.teams.map((t) => t.team_id)).toEqual([TEX]);
    });
    test('the table: a tbody per conference, jump links, the filter over team rows', async () => {
        const g = groupsOf(2026);
        const html = await container.renderToString(NbaConferenceTeams, { props: { groups: g, lines: teamLinesFromRows(seasonPlayers(2026)), seasonQuery: '' }, locals: { league: 'mbb' } as App.Locals });
        expect(html.match(/<tbody id="conf-/g)).toHaveLength(g.length);
        expect(html.match(/<a href="#conf-/g)).toHaveLength(g.length);
        expect(html.match(/<tr data-name=/g)).toHaveLength(g.reduce((a, x) => a + x.teams.length, 0));
        expect(html).toContain(`href="/mbb/team/${TEX}"`);
        expect(html).toContain('data-nba-filter="nba-teams-table"');
        expect(html).toContain('placeholder="team name"');
        expect(html).toMatch(/data-name="tex texas longhorns sec"/);
        expect(html).not.toContain('NaN');
    });
});

describe('the teams loader', () => {
    test('college: conferences on success, null (ungrouped, uncacheable) on a failed read', async () => {
        vi.resetModules();
        let fail = false;
        let failGames = false;
        vi.doMock('../../src/resources/nbaShots', async () => ({
            ...(await vi.importActual<typeof import('../../src/resources/nbaShots')>('../../src/resources/nbaShots')),
            retrieveSeasonPlayerRows: async () => seasonPlayers(2026),
            retrieveCoverageRows: async () => coverage(),
            retrieveConferenceRows: async () => { if (fail) throw new Error('down'); return { teams: conferences(2026), groups: conferenceNames(2026) }; },
            retrieveScheduleTeamRows: async () => { if (failGames) throw new Error('down'); return scheduleTeams(2026); },
        }));
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const astro = () => { const cache: unknown[] = []; return { a: { params: {}, url: new URL('https://gameonpaper.com/mbb/teams'), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache }; };
        const ok = astro();
        const r: any = await prepareBasketballTeams(ok.a, 'mbb');
        expect(r.conferences.length).toBeGreaterThan(25);
        expect(r.conferences.flatMap((g: any) => g.teams).length).toBe(365); // the members (D43/D47)
        for (const [f, g] of [[true, false], [false, true]] as const) { // either reference read failing: plan #6's cards, uncacheable
            fail = f; failGames = g;
            const bad = astro();
            const r2: any = await prepareBasketballTeams(bad.a, 'mbb');
            expect(r2.conferences).toBeNull();
            expect(r2.teams.length).toBe(r.teams.length);
            expect(bad.cache.at(-1)).toBe(false);
            expect(bad.a.response.headers.get('Cache-Control')).toBe('no-store');
        }
        vi.doUnmock('../../src/resources/nbaShots');
    });
});
