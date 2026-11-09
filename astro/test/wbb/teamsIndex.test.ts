// astro/test/wbb/teamsIndex.test.ts
// D38 + D43/D47 through plan #9's withSeasonMembers (R7): the WBB teams index is every member of the season (a conference row
// AND >= 1 game), with or without linked shots, grouped by the season's conferences.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { conferenceGroups, withSeasonMembers } from '../../src/basketball/dashboards';
import NbaConferenceTeams from '../../src/components/nba/NbaConferenceTeams.astro';
import { teamLinesFromRows, teamsFromSeasonRows } from '../../src/nba/tables';
import { WBB_CONFERENCES } from '../../src/nba/data/wbbTeams';
import { SC, conferenceNames, conferences, coverage, scheduleTeams, seasonPlayers, unlinkedPrograms } from './dashboardFixtures';

const members = (season: 2019 | 2026) => withSeasonMembers(teamsFromSeasonRows(seasonPlayers(season), season, 'wbb'), conferences(season), scheduleTeams(season), season, 'wbb');
const ids = (season: 2019 | 2026) => new Set(conferences(season).map((r) => Number(r.team_id)));
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

describe('withSeasonMembers on WBB (D38, D43, D47)', () => {
    test('2025-26: 363 programs, the four unlinked ones and the six reclassifiers among them, no duplicate', () => {
        const t = members(2026);
        expect(t).toHaveLength(363);
        expect(new Set(t.map((x) => x.team_id)).size).toBe(363);
        for (const id of [...unlinkedPrograms().find((r) => r.season === 2026)!.members_without_shots!, 88, 284, 2330, 2511, 2815, 2837]) {
            expect(t.some((x) => x.team_id === id), String(id)).toBe(true);
        }
        expect(t.find((x) => x.team_id === 2441)!.name).toBe(BASKETBALL.wbb.teams.inSeason(2441, 2026)!.name);
    });
    test('2018-19: exactly the 351 reference programs (every one played); LIU 112358 has no 2019 conference row, so it is out', () => {
        const t = members(2019);
        expect(new Set(t.map((x) => x.team_id))).toEqual(ids(2019));
        expect(t).toHaveLength(351);
        expect(t.some((x) => x.team_id === 112358)).toBe(false);
        expect(t.some((x) => x.team_id === 2341)).toBe(true); // LIU Brooklyn: a 2019 member with no linked shot
        expect(seasonPlayers(2019).some((r) => r.team_id === 112358)).toBe(false); // R-S5: nor any 2019 derived row (Task 9's producer issue)
    });
    test('2020-21: a conference row with no game is not a member (D47: the Ivy League and three HBCUs)', () => {
        const played = new Set(scheduleTeams(2021).flatMap((g) => [g.home_id, g.away_id]).filter((x) => x != null).map(Number));
        const noGame = conferences(2021).filter((r) => !played.has(Number(r.team_id)));
        expect(noGame.length).toBeGreaterThanOrEqual(11);
        const t = withSeasonMembers([], conferences(2021), scheduleTeams(2021), 2021, 'wbb');
        for (const r of noGame) expect(t.some((x) => x.team_id === Number(r.team_id)), r.team_id).toBe(false);
    });
    test('an id the team module cannot resolve that season is dropped, never invented', () => {
        const rows = [...conferences(2026), { team_id: '2697', conference_id: 'wbb:gulf-south' }]; // West Florida: D-I from 2027
        const games = [...scheduleTeams(2026), { home_id: 2697, away_id: 2697 }];
        expect(withSeasonMembers(teamsFromSeasonRows(seasonPlayers(2026), 2026, 'wbb'), rows, games, 2026, 'wbb')).toHaveLength(363);
    });
});

describe('the WBB teams index by conference', () => {
    test('2025-26: 31 conferences, every program in exactly one; South Carolina in the SEC; no "Other Division I"', () => {
        const g = conferenceGroups(members(2026), conferences(2026), conferenceNames(2026));
        expect(g).toHaveLength(31);
        expect(g.reduce((a, x) => a + x.teams.length, 0)).toBe(363);
        expect(g.some((x) => x.id === '')).toBe(false);
        expect(g.find((x) => x.teams.some((t) => t.team_id === SC))!.label).toBe('SEC');
        expect(g.find((x) => x.teams.some((t) => t.team_id === 251))!.label).toBe('SEC');
    });
    test('2018-19: 2019 membership (Texas in the Big 12); every program in a named conference', () => {
        const g = conferenceGroups(members(2019), conferences(2019), conferenceNames(2019));
        expect(g.find((x) => x.teams.some((t) => t.team_id === 251))!.label).toBe('Big 12');
        expect(g.some((x) => x.id === '')).toBe(false);
        expect(g.reduce((a, x) => a + x.teams.length, 0)).toBe(351);
    });
    test("Decision 10: every 2026 reference conference is one of ESPN's women's conferences (labels or the stated aliases); only the Pac-12 is ESPN-only", () => {
        const ALIAS: Record<string, string> = {
            'America East': 'Am. East', ASUN: 'Atlantic Sun', 'Atlantic 10': 'A-10', 'C-USA': 'CUSA', MAAC: 'Metro', 'Missouri Valley': 'MVC', 'Ohio Valley': 'OVC', WAC: 'UAC',
        };
        const labels = new Set(WBB_CONFERENCES.map((c) => c.label));
        const mapped = conferenceNames(2026).map((c) => ALIAS[c.short_name] ?? c.short_name);
        expect(mapped.filter((l) => !labels.has(l))).toEqual([]);
        expect([...labels].filter((l) => !mapped.includes(l))).toEqual(['Pac-12']);
        expect(conferenceNames(2026).find((c) => c.group_id === 'wbb:summit')!.short_name).toBe('Summit');
    });
    test('the table: 363 rows, a link for every program, n/a lines for the five without season-player rows', async () => {
        // the four unlinked programs, plus R-S13: New Orleans 2443 has placed shots but no season-player row, so its line is n/a too
        const g = conferenceGroups(members(2026), conferences(2026), conferenceNames(2026));
        const html = await container.renderToString(NbaConferenceTeams, { props: { groups: g, lines: teamLinesFromRows(seasonPlayers(2026)), seasonQuery: '' }, locals: { league: 'wbb' } as App.Locals });
        expect(html.match(/<tr data-name=/g)).toHaveLength(363);
        expect(new Set([...html.matchAll(/href="\/wbb\/team\/(\d+)"/g)].map((m) => m[1])).size).toBe(363);
        for (const id of [2130, 2385, 2441, 2443, 2837]) {
            const row = html.slice(html.indexOf(`href="/wbb/team/${id}"`));
            expect(row.slice(0, row.indexOf('</tr>')), String(id)).toContain('n/a');
        }
        expect(html).not.toContain('NaN');
    });
});

describe('the teams loader (plan #9\'s, on WBB)', () => {
    test('wbb lists the 363 season members; a failed reference read falls back to teams with shots, uncacheable', async () => {
        vi.resetModules();
        let fail = false;
        vi.doMock('../../src/resources/nbaShots', async () => ({
            ...(await vi.importActual<typeof import('../../src/resources/nbaShots')>('../../src/resources/nbaShots')),
            retrieveSeasonPlayerRows: async () => seasonPlayers(2026),
            retrieveCoverageRows: async () => coverage(),
            retrieveConferenceRows: async () => { if (fail) throw new Error('down'); return { teams: conferences(2026), groups: conferenceNames(2026) }; },
            retrieveScheduleTeamRows: async () => scheduleTeams(2026),
        }));
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const astro = () => ({ params: {}, url: new URL('https://gameonpaper.com/wbb/teams'), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } } as any);
        const r: any = await prepareBasketballTeams(astro(), 'wbb');
        expect(r.conferences.reduce((a: number, g: any) => a + g.teams.length, 0)).toBe(363);
        fail = true;
        const a = astro();
        const r2: any = await prepareBasketballTeams(a, 'wbb');
        expect(r2.conferences).toBeNull(); // plan #9's failed-read path: the teams-with-shots cards
        expect(r2.teams.length).toBe(new Set(seasonPlayers(2026).map((x) => x.team_id)).size);
        expect(a.response.headers.get('Cache-Control')).toBe('no-store');
        vi.doUnmock('../../src/resources/nbaShots');
    });
});
