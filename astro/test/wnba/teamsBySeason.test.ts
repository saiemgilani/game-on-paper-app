// astro/test/wnba/teamsBySeason.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { headshotsFromRows, playerSeasonsFromRows } from '../../src/nba/adapters';
import { scatterPoints } from '../../src/nba/data/scatter';
import { teamInSeason, teamById } from '../../src/nba/data/teams';
import { WNBA_TEAMS, wnbaFranchiseOf, wnbaTeamInSeason } from '../../src/nba/data/wnbaTeams';
import { teamHrefFromEspn } from '../../src/nba/links';
import { teamsFromSeasonRows } from '../../src/nba/tables';
import { apiSeasonPlayerRows } from '../nba/rows';
import { SEA, seasonPlayers } from './dashboardFixtures';

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number) => seasonPlayers(s as 2026),
    retrieveLeagueContextRows: vi.fn(async (): Promise<any[]> => { throw new Error('league context down'); }), // only the teams index's placeholder note reads it here
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
        const teams = teamsFromSeasonRows(rows, 2026, 'nba');
        expect(teams.map((t) => t.tricode)).toEqual([
            'ATL', 'BKN', 'BOS', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM',
            'MIA', 'MIL', 'MIN', 'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
        ]);
        expect(teams.find((t) => t.tricode === 'BKN')).toEqual({ team_id: 1610612751, tricode: 'BKN', name: 'Brooklyn Nets', color: '#000000', espn_id: 17 });
        expect(teams.some((t) => t.color === '#888888')).toBe(false);
        expect(teamInSeason(1610612751, 2012)).toEqual({ ...teamById(1610612751)!, name: 'New Jersey Nets' });
        expect(BASKETBALL.nba.teams.franchiseOf('NJN')).toBe(1610612751);
    });
});

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wnba/${name}.json`, import.meta.url), 'utf8'));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('plan #6 final-review fixes, on real fixtures', () => {
    test('seasonsOf: every franchise identity spans exactly its shots seasons (team_seasons_1997_2026.json)', () => {
        // one row per (team id, tricode): group a franchise's tricodes, split 1611661327's two franchises by tricode (POR / PDX)
        const spans = new Map<string, { id: number; first: number; last: number }>();
        for (const r of fixture('team_seasons_1997_2026') as { team_id: number; team_tricode: string; first: number; last: number }[]) {
            const key = r.team_tricode === 'POR' ? 'POR' : String(r.team_id);
            const s = spans.get(key);
            spans.set(key, { id: r.team_id, first: Math.min(r.first, s?.first ?? r.first), last: Math.max(r.last, s?.last ?? r.last) });
        }
        expect(spans.size).toBe(21); // 15 current franchises + 6 folded
        for (const [key, { id, first, last }] of spans) {
            for (const season of [first, last]) expect(BASKETBALL.wnba.teams.seasonsOf(id, season), `${key} ${season}`).toEqual(range(first, last));
        }
        expect(BASKETBALL.wnba.teams.seasonsOf(1611661331, 2026)).toEqual([2025, 2026]); // Golden State's picker: 2025-2026 only
        expect(BASKETBALL.wnba.teams.seasonsOf(1611661327, 2026)).toEqual([2026]); // the 2026 Fire never reaches the 2000-02 one
        expect(BASKETBALL.wnba.teams.seasonsOf(1611661327, 2002)).toEqual([2000, 2001, 2002]);
        expect(BASKETBALL.wnba.teams.seasonsOf(0, 2025)).toBeUndefined();
        for (const t of WNBA_TEAMS) expect(BASKETBALL.wnba.teams.seasonsOf(t.team_id, 2026)!.at(-1)).toBe(2026);
        // the NBA: every listed season for every team, so its pickers are unchanged
        expect(BASKETBALL.nba.teams.seasonsOf(1610612751, 2026)).toEqual(range(1998, 2026));
        expect(BASKETBALL.nba.teams.seasonsOf(1, 2026)).toBeUndefined();
    });
    test('teamHrefFromEspn on the real 2002-06-15 board: the season rides along, the team id resolves to that season', () => {
        const events = fixture('scoreboard-20020615').content.sbData.events as any[];
        const href: Record<string, string | null> = {};
        for (const e of events) for (const c of e.competitions[0].competitors) href[c.team.id] = teamHrefFromEspn(c.team, 'wnba', e.season.year);
        expect(href).toEqual({
            '132052': '/wnba/team/1611661327?season=2002', // ESPN files the 2000-02 Fire under the 2026 Fire's id
            '3': '/wnba/team/1611661321?season=2002', '15': '/wnba/team/1611661319?season=2002', '10': '/wnba/team/1611661323?season=2002',
            '6': '/wnba/team/1611661320?season=2002', '5': '/wnba/team/1611661325?season=2002', '8': '/wnba/team/1611661324?season=2002',
            '14': '/wnba/team/1611661328?season=2002',
            '13': null, '7': null, '2': null, '4': null, // folded franchises: no team link, as before
        });
        // and those pages are that season's teams: the old Fire, the Shock, the Starzz, the Miracle
        expect([[1611661327, 2002], [1611661321, 2002], [1611661319, 2002], [1611661323, 2002]].map(([id, s]) => BASKETBALL.wnba.teams.inSeason(id, s)!.name))
            .toEqual(['Portland Fire', 'Detroit Shock', 'Utah Starzz', 'Orlando Miracle']);
        expect(BASKETBALL.wnba.teams.inSeason(1611661327, 2002)!.tricode).toBe('POR');
        expect(teamHrefFromEspn({ id: '9' }, 'wnba', 2026)).toBe('/wnba/team/1611661313'); // the current season: the canonical URL
        expect(teamHrefFromEspn({ id: '9' }, 'wnba', 2031)).toBe('/wnba/team/1611661313'); // an unlisted season: no ?season=
        expect(teamHrefFromEspn({ id: '17' }, 'nba', 2010)).toBe('/nba/team/1610612751'); // the NBA: season-less, as before
    });
    test('the teams index without its placeholder note (league context down) is uncacheable', async () => {
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const set = vi.fn();
        const astro = { ...fakeAstro('/wnba/teams?season=2003'), cache: { set } };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const r: any = await prepareBasketballTeams(astro, 'wnba');
        warn.mockRestore();
        expect([r.teams.length, r.unlocated]).toEqual([14, undefined]);
        expect(set.mock.calls.at(-1)).toEqual([false]);
        expect(astro.response.headers.get('Cache-Control')).toBe('no-store');
    });
    test.each([
        ['no total row', [{ season: 2003, kind: 'zone', key1: 0, key2: null, attempts: 10, makes: 5, fg3a: 0, fg3m: 0 }]],
        ['a total row without placeholder_shots', [{ season: 2003, kind: 'total', key1: null, key2: null, attempts: 28436, makes: 12000, fg3a: 0, fg3m: 0 }]],
    ])('the teams index with incomplete league context (%s) is uncacheable', async (_label, rows) => {
        const shots = await import('../../src/resources/nbaShots');
        vi.mocked(shots.retrieveLeagueContextRows).mockResolvedValueOnce(rows);
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const set = vi.fn();
        const astro = { ...fakeAstro('/wnba/teams?season=2003'), cache: { set } };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const r: any = await prepareBasketballTeams(astro, 'wnba');
        warn.mockRestore();
        expect(r.unlocated).toBeUndefined();
        expect(set.mock.calls.at(-1)).toEqual([false]);
        expect(astro.response.headers.get('Cache-Control')).toBe('no-store');
    });
    test('prepareBasketballScatter wires the season colours: Seattle #2C5235 in 2026; 2003 Houston grey, San Antonio in Las Vegas silver', async () => {
        const { prepareBasketballScatter } = await import('../../src/routes/basketball/scatter');
        const r26: any = await prepareBasketballScatter(fakeAstro('/wnba/scatter'), 'wnba');
        const sea = r26.points.filter((p: any) => p.team_id === SEA);
        expect(sea.length).toBeGreaterThan(0);
        expect(new Set(sea.map((p: any) => p.color))).toEqual(new Set(['#2C5235']));
        const r03: any = await prepareBasketballScatter(fakeAstro('/wnba/scatter?season=2003'), 'wnba');
        const colors = (id: number) => new Set(r03.points.filter((p: any) => p.team_id === id).map((p: any) => p.color));
        expect(colors(1611661316)).toEqual(new Set(['#888888']));
        expect(colors(1611661319)).toEqual(new Set(['#A7A8AA']));
    });
});
