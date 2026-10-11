// test/nba/tables.test.ts
import { describe, expect, test } from 'vitest';
import { playerSeasonsFromRows } from '../../src/nba/adapters';
import { NETS_TEAM_ID } from '../../src/nba/data/teams';
import { PLAYER_COLUMNS, ROSTER_COLUMNS, parseDir, parseMode, parseSort, playerRows, rosterRows, sortPlayerRows, sortRosterRows, teamLinesFromRows, teamsFromSeasonRows } from '../../src/nba/tables';
import { apiSeasonPlayerRows, seasonPlayerRows } from './rows';

const api = apiSeasonPlayerRows();

describe('teamsFromSeasonRows', () => {
    test('one entry per team_id in the rows, sorted by tricode, with the season name', () => {
        const teams = teamsFromSeasonRows(api, 2026);
        expect(teams.length).toBe(30);
        expect(teams.map((t) => t.tricode)).toEqual([...teams.map((t) => t.tricode)].sort());
        const bkn = teams.find((t) => t.team_id === NETS_TEAM_ID)!;
        expect(bkn.tricode).toBe('BKN');
        expect(bkn.name).toBe('Brooklyn Nets');
    });
    test('a former name follows the season, not the current one', () => {
        const njn = api.filter((r) => r.team_id === NETS_TEAM_ID).map((r) => ({ ...r, season: 2010, team_tricode: 'NJN' }));
        const [t] = teamsFromSeasonRows(njn, 2010);
        expect(t.tricode).toBe('NJN');
        expect(t.name).toBe('New Jersey Nets');
    });
    test('an unlisted team_id still appears, named by its tricode', () => {
        const [t] = teamsFromSeasonRows([{ ...api[0], team_id: 1, team_tricode: 'XXX' }], 2026);
        expect(t).toMatchObject({ team_id: 1, tricode: 'XXX', name: 'XXX' });
    });
});

describe('teamLinesFromRows', () => {
    test("a team's line sums every row on that team, traded players' rows included", () => {
        const lines = teamLinesFromRows(api);
        expect(lines.size).toBe(30);
        const bkn = api.filter((r) => r.team_id === NETS_TEAM_ID);
        const attempts = bkn.reduce((a, r) => a + r.attempts, 0);
        const makes = bkn.reduce((a, r) => a + r.makes, 0);
        expect(lines.get(NETS_TEAM_ID)).toMatchObject({ attempts, makes, fgPct: makes / attempts });
    });
});

describe('playerRows', () => {
    test('one row per player with the primary team, from the league-wide seasons', () => {
        const rows = playerRows(playerSeasonsFromRows(api));
        expect(rows.length).toBe(new Set(api.map((r) => r.person_id)).size);
        expect(rows[0].attempts).toBeGreaterThanOrEqual(rows[1].attempts);
        const traded = api.find((r) => r.n_teams > 1 && r.has_stats)!;
        const row = rows.find((r) => r.person_id === traded.person_id)!;
        expect(row.acrossTeams).toBe(false); // league-wide rows sum his teams, so the stats match the attempts
    });
    test("one team's rows mark a traded player's season-total stats", () => {
        const traded = api.find((r) => r.n_teams > 1 && r.has_stats)!;
        const rows = playerRows(playerSeasonsFromRows(api, traded.team_id));
        const row = rows.find((r) => r.person_id === traded.person_id)!;
        expect(row.acrossTeams).toBe(true);
        expect(row.min).toBe(traded.min_pg);
    });
});

describe('rosterRows', () => {
    test('rim and mid FG% come from the derived counts; 3P rate from the row', () => {
        const rows = rosterRows(seasonPlayerRows().map((r) => ({ ...r, ra_attempts: 10, ra_makes: 6, mid_attempts: 4, mid_makes: 1 })), NETS_TEAM_ID);
        expect(rows.length).toBe(seasonPlayerRows().length);
        expect(rows[0].rimPct).toBeCloseTo(0.6);
        expect(rows[0].midPct).toBeCloseTo(0.25);
        const top = seasonPlayerRows().sort((a, b) => b.attempts - a.attempts)[0];
        expect(rows[0].fg3Rate).toBeCloseTo(top.fg3a / top.attempts);
    });
    test('zero attempts in a zone is n/a, not 0%', () => {
        const [r] = rosterRows([{ ...seasonPlayerRows()[0], ra_attempts: 0, ra_makes: 0 }], NETS_TEAM_ID);
        expect(r.rimPct).toBeNull();
    });
    test('a traded player on this team keeps this team\'s FGA but season-total GP, with acrossTeams set', () => {
        const traded = api.find((r) => r.n_teams > 1 && r.has_stats)!;
        const rows = rosterRows(api, traded.team_id);
        const row = rows.find((r) => r.person_id === traded.person_id)!;
        expect(row.fga).toBe(traded.attempts);
        expect(row.gp).toBe(traded.gp);
        expect(row.acrossTeams).toBe(true);
        expect(row).toMatchObject({ minPg: traded.min_pg, minTotal: traded.min_total, fgaPg: traded.fga_pg, tsPct: traded.ts_pct, usgPct: traded.usg_pct, pie: traded.pie, headshot: traded.headshot_href });
        expect(rows.every((r) => api.some((a) => a.person_id === r.person_id && a.team_id === traded.team_id))).toBe(true);
    });
    test('no stats row leaves the stats columns null and the shots columns filled', () => {
        const [r] = rosterRows([{ ...seasonPlayerRows()[0], has_stats: false, gp: null, min_pg: null }], NETS_TEAM_ID);
        expect(r.gp).toBeNull();
        expect(r.tsPct).toBeNull();
        expect(r.fga).toBeGreaterThan(0);
    });
});

describe('sorting and the query whitelists', () => {
    test('parseSort falls back for anything off the list; parseDir and parseMode are exact-match', () => {
        const keys = PLAYER_COLUMNS.map((c) => c.key);
        expect(parseSort(keys, 'fgPct', 'attempts')).toBe('fgPct');
        expect(parseSort(keys, 'drop table', 'attempts')).toBe('attempts');
        expect(parseSort(keys, null, 'attempts')).toBe('attempts');
        expect(parseDir('asc')).toBe('asc');
        expect(parseDir('ASC')).toBe('desc');
        expect(parseDir(null)).toBe('desc');
        expect(parseMode('pergame')).toBe('pergame');
        expect(parseMode('per game')).toBe('totals');
    });
    test('sortPlayerRows sorts a copy by the column, both directions', () => {
        const rows = playerRows(playerSeasonsFromRows(api));
        const desc = sortPlayerRows(rows, 'gp', 'desc');
        const asc = sortPlayerRows(rows, 'gp', 'asc');
        for (let i = 1; i < rows.length; i++) {
            expect(desc[i - 1].gp ?? -1).toBeGreaterThanOrEqual(desc[i].gp ?? -1);
            expect(asc[i - 1].gp ?? Infinity).toBeLessThanOrEqual(asc[i].gp ?? Infinity);
        }
        expect(rows).not.toBe(desc); // a copy
    });
    test('sortRosterRows reads the per-game column when mode is pergame', () => {
        const rows = rosterRows(api, NETS_TEAM_ID);
        const byTotals = sortRosterRows(rows, 'min', 'desc', 'totals');
        const byPerGame = sortRosterRows(rows, 'min', 'desc', 'pergame');
        expect(byTotals[0].minTotal).toBe(Math.max(...rows.map((r) => r.minTotal ?? -1)));
        expect(byPerGame[0].minPg).toBe(Math.max(...rows.map((r) => r.minPg ?? -1)));
    });
    test('the column tables carry every sort key once and format null as n/a', () => {
        expect(new Set(PLAYER_COLUMNS.map((c) => c.key)).size).toBe(PLAYER_COLUMNS.length);
        expect(new Set(ROSTER_COLUMNS.map((c) => c.key)).size).toBe(ROSTER_COLUMNS.length);
        for (const c of [...PLAYER_COLUMNS, ...ROSTER_COLUMNS]) expect(c.fmt(null)).toBe('n/a');
        expect(ROSTER_COLUMNS.find((c) => c.key === 'min')!.label('pergame')).toBe('MIN/g');
        expect(ROSTER_COLUMNS.find((c) => c.key === 'min')!.label('totals')).toBe('MIN');
        expect(ROSTER_COLUMNS.find((c) => c.key === 'fga')!.label('pergame')).toBe('FGA/g');
        expect(ROSTER_COLUMNS.find((c) => c.key === 'fga')!.label('totals')).toBe('FGA');
    });
});
