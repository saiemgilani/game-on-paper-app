// astro/test/wnba/teamsBySeason.test.ts
import { describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { headshotsFromRows, playerSeasonsFromRows } from '../../src/nba/adapters';
import { scatterPoints } from '../../src/nba/data/scatter';
import { teamInSeason, teamById } from '../../src/nba/data/teams';
import { wnbaFranchiseOf, wnbaTeamInSeason } from '../../src/nba/data/wnbaTeams';
import { teamsFromSeasonRows } from '../../src/nba/tables';
import { apiSeasonPlayerRows } from '../nba/rows';
import { SEA, seasonPlayers } from './dashboardFixtures';

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number) => seasonPlayers(s as 2026),
}));
const fakeAstro = (path: string) => ({ params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;
const names = (season: 2003 | 2025 | 2026) => Object.fromEntries(teamsFromSeasonRows(seasonPlayers(season), season, 'wnba').map((t) => [t.tricode, t.name]));

describe('WNBA teams by season, on the real season rows', () => {
    test("2003: folded franchises by their own names, relocated ones by that season's", () => {
        const n = names(2003);
        expect(Object.keys(n)).toHaveLength(14);
        expect(n).toMatchObject({
            CHA: 'Charlotte Sting', CLE: 'Cleveland Rockers', HOU: 'Houston Comets', SAC: 'Sacramento Monarchs',
            DET: 'Detroit Shock', SAN: 'San Antonio Silver Stars', CON: 'Connecticut Sun', SEA: 'Seattle Storm',
        });
        const hou = teamsFromSeasonRows(seasonPlayers(2003), 2003, 'wnba').find((t) => t.tricode === 'HOU')!;
        expect([hou.team_id, hou.espn_id, hou.color]).toEqual([1611661316, 4, '#888888']);
    });
    test('2025: thirteen teams; the team_id 0 row is no team', () => {
        const teams = teamsFromSeasonRows(seasonPlayers(2025), 2025, 'wnba');
        expect(teams).toHaveLength(13);
        expect(teams.some((t) => t.team_id === 0 || t.tricode === '')).toBe(false);
        expect(names(2025).GSV).toBe('Golden State Valkyries');
    });
    test('2026: the fifteen current franchises, with their colours', () => {
        const teams = teamsFromSeasonRows(seasonPlayers(2026), 2026, 'wnba');
        expect(teams.map((t) => t.team_id).sort()).toEqual(BASKETBALL.wnba.teams.all.map((t) => t.team_id).sort());
        expect(teams.find((t) => t.team_id === SEA)!.color).toBe('#2C5235');
    });
    test('1611661327: the 2000-02 Portland Fire is not the 2026 one', () => {
        for (const s of [2000, 2002]) expect(wnbaTeamInSeason(1611661327, s)).toEqual({ team_id: 1611661327, tricode: 'POR', name: 'Portland Fire', color: '#888888', espn_id: 12 });
        expect(wnbaTeamInSeason(1611661327, 2026)).toMatchObject({ tricode: 'PDX', espn_id: 132052 });
        expect(wnbaTeamInSeason(1611661319, 2002)!.name).toBe('Utah Starzz');
        expect(wnbaTeamInSeason(1611661319, 2017)!.name).toBe('San Antonio Stars');
        expect(wnbaTeamInSeason(1611661319, 2018)!.name).toBe('Las Vegas Aces');
        expect(wnbaTeamInSeason(0, 2025)).toBeUndefined();
    });
    test('franchises: a former tricode finds the current franchise, a folded one finds none', () => {
        expect(['SAN', 'UTA', 'LVA', 'DET', 'TUL', 'ORL', 'PHO', 'PDX'].map(wnbaFranchiseOf))
            .toEqual([1611661319, 1611661319, 1611661319, 1611661321, 1611661321, 1611661323, 1611661317, 1611661327]);
        for (const t of ['POR', 'HOU', 'CHA', 'CLE', 'MIA', 'SAC', 'XYZ']) expect(wnbaFranchiseOf(t), t).toBeUndefined();
    });
    test('the players page: ?team=SAN in 2026 is Las Vegas; ?team=POR in 2026 is a 404', async () => {
        const { prepareBasketballPlayers } = await import('../../src/routes/basketball/players');
        const lv: any = await prepareBasketballPlayers(fakeAstro('/wnba/players?season=2026&team=SAN'), 'wnba');
        expect(lv.selected.team_id).toBe(1611661319);
        expect(await prepareBasketballPlayers(fakeAstro('/wnba/players?season=2026&team=POR'), 'wnba')).toEqual({ notFound: true });
    });
    test('scatter dots take the WNBA colours', () => {
        const rows = seasonPlayers(2026);
        const pts = scatterPoints(playerSeasonsFromRows(rows), headshotsFromRows(rows), null, { colorOf: (id) => BASKETBALL.wnba.teams.inSeason(id, 2026)?.color });
        expect(pts.filter((p) => p.team_id === SEA).every((p) => p.color === '#2C5235')).toBe(true);
        expect(pts.some((p) => p.nets)).toBe(false);
    });
    test('the NBA: the same teams and franchises as before', () => {
        const rows = apiSeasonPlayerRows();
        expect(teamsFromSeasonRows(rows, 2026, 'nba')).toEqual(teamsFromSeasonRows(rows, 2026));
        expect(teamInSeason(1610612751, 2012)).toEqual({ ...teamById(1610612751)!, name: 'New Jersey Nets' });
        expect(BASKETBALL.nba.teams.franchiseOf('NJN')).toBe(1610612751);
    });
});
