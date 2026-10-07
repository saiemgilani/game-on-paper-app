import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { neighborWindow, playerKey, playerNeighborLists, teamKey, teamNeighborLists } from '../src/utils/neighbors';
import { generateColorRampValue, generateMarginalString, roundNumber } from '../src/utils/misc';

const fx = JSON.parse(readFileSync(new URL('./fixtures/neighbors-ranked-rows.json', import.meta.url)).toString());

describe('neighborWindow', () => {
    test('NFL 2025 teams: rows within five ranks only, ordered by rank, exactly one self row, none dropped', () => {
        const rows = fx.nfl_team_summaries_2025;
        for (const t of rows) {
            const id = teamKey(t);
            const r = t.EPAplay_off_rank;
            const win = neighborWindow(rows, teamKey, id, 'EPAplay_off');
            expect(win.filter((n) => n.self).map((n) => n.key)).toEqual([id]);
            for (const n of win) expect(Math.abs(n.rank - r)).toBeLessThanOrEqual(5);
            expect(win.map((n) => n.rank)).toEqual(win.map((n) => n.rank).toSorted((a, b) => a - b));
            expect(win).toHaveLength(rows.filter((x: any) => Math.abs(x.EPAplay_off_rank - r) <= 5).length);
        }
    });

    test('the rank-1 team: the window starts at 1 and holds at most six rows', () => {
        const rows = fx.nfl_team_summaries_2025;
        const top = rows.find((r: any) => r.EPAplay_off_rank === 1);
        const win = neighborWindow(rows, teamKey, teamKey(top), 'EPAplay_off');
        expect(win[0].rank).toBe(1);
        expect(win.length).toBeLessThanOrEqual(6);
    });

    test('ids compare as strings: a numeric NFL team id and its string give the same window', () => {
        const rows = fx.nfl_team_summaries_2025;
        expect(typeof rows[0].team_id).toBe('number');
        expect(neighborWindow(rows, teamKey, String(rows[0].team_id), 'success_off'))
            .toEqual(neighborWindow(rows, teamKey, rows[0].team_id, 'success_off'));
    });

    test('a traded player is keyed by player AND team: his NYJ row is self, once', () => {
        const win = neighborWindow(fx.nfl_receiving_2024, playerKey, '00-0031381:20', 'EPAplay');
        expect(win.filter((n) => n.self)).toHaveLength(1);
        expect(win.find((n) => n.self)!.row.team_id).toBe(20);
    });

    test('no rank, no window: the LV stint is under the qualifier; an unknown id has nothing', () => {
        expect(neighborWindow(fx.nfl_receiving_2024, playerKey, '00-0031381:13', 'EPAplay')).toEqual([]);
        expect(neighborWindow(fx.nfl_team_summaries_2025, teamKey, 'no-such-team', 'EPAplay_off')).toEqual([]);
    });
});

describe('display rows', () => {
    test('team lists: six metrics in order, canonical titles, league-prefixed hrefs, leaderboard formatting', () => {
        const rows = fx.nfl_team_summaries_2025;
        const lists = teamNeighborLists(rows, rows[0].team_id, 'nfl', 2025);
        expect(lists.map((l) => l.metric)).toEqual(['net_adj_epa', 'EPAplay_off', 'success_off', 'explosive_off', 'EPAplay_def', 'success_def']);
        expect(lists[0].title).toBe('Net Adj EPA/Play');
        expect(lists[1].title).toBe('Off EPA/Play');
        for (const l of lists) for (const c of l.rows) expect(c.href).toMatch(/^\/nfl\/year\/2025\/team\/\d+$/);
        expect(lists[2].rows.find((c) => c.self)!.value).toBe(`${roundNumber(rows[0].success_off * 100, 2, 1)}%`);

        // net_adj_epa is a differential, exactly like TeamLeaderboardTable/TeamCard/MatchupView:
        // a positive value gets generateMarginalString's leading '+', never a bare roundNumber
        const topTeam = rows.find((r: any) => r.net_adj_epa_rank === 1);
        expect(topTeam.net_adj_epa).toBeGreaterThan(0);
        const topSelf = teamNeighborLists(rows, topTeam.team_id, 'nfl', 2025)[0].rows.find((c) => c.self)!;
        expect(topSelf.value.startsWith('+')).toBe(true);
        expect(topSelf.value).toBe(generateMarginalString(topTeam.net_adj_epa, 2, 2));

        // a percent metric (explosive_off, which has no SDV_TEAM_METRIC_FORMATTING_VALUES entry
        // of its own) still ends with '%' after the differential fix
        expect(lists[3].rows.find((c) => c.self)!.value.endsWith('%')).toBe(true);
    });

    test('player lists: leaderboard titles, and links only for a viewer the player-pages flag admits', () => {
        const rows = fx.cfb_passing_2024;
        const mccord = rows.find((r: any) => String(r.player_id) === '4433971');
        const key = playerKey(mccord);
        const pub = playerNeighborLists(rows, key, 'passing', { league: 'cfb' }, 2024);
        expect(pub.map((l) => l.title)).toEqual(['EPA/DB', 'Pass SR%', 'Yards/DB', 'EPA']);
        expect(pub.every((l) => l.rows.every((c) => c.href === null))).toBe(true);
        const prev = playerNeighborLists(rows, key, 'passing', { league: 'cfb', preview: true }, 2024);
        expect(prev[0].rows.find((c) => c.self)!.href).toBe('/players/4433971?season=2024');
    });
});

describe('metric cell shading (the season leaderboards\' ramp)', () => {
    test('teams: rank 1 green, last purple, the middle unshaded; every cell as TeamLeaderboardTable shades it', () => {
        const rows = fx.nfl_team_summaries_2025;
        const selfCell = (rank: number) => {
            const t = rows.find((r: any) => r.net_adj_epa_rank === rank);
            return teamNeighborLists(rows, t.team_id, 'nfl', 2025)[0].rows.find((c) => c.self)!;
        };
        expect(selfCell(1).shade).toBe('hulk-bg-level-9');
        expect(selfCell(32).shade).toBe('hulk-bg-level-0');
        expect(selfCell(16).shade).toBeNull();
        // TeamLeaderboardTable: generateColorRampValue(rank, every ranked team, inverted)
        for (const l of teamNeighborLists(rows, 14, 'nfl', 2025)) {
            const win = neighborWindow(rows, teamKey, 14, l.metric);
            expect(l.rows.map((c) => c.shade)).toEqual(win.map((n) => generateColorRampValue(n.rank, rows.length, true)));
        }
    });

    test('players: the denominator is every passer ranked on the metric (131), not the window', () => {
        const rows = fx.cfb_passing_2024;
        const mid = rows.find((r: any) => r.EPAplay_rank === 66);
        const cell = playerNeighborLists(rows, playerKey(mid), 'passing', { league: 'cfb' }, 2024)[0].rows.find((c) => c.self)!;
        // 65/131 rounds to the unshaded middle; over the window's own length it would be purple
        expect(cell.shade).toBeNull();
        const last = rows.find((r: any) => r.EPAplay_rank === 131);
        expect(playerNeighborLists(rows, playerKey(last), 'passing', { league: 'cfb' }, 2024)[0].rows.find((c) => c.self)!.shade).toBe('hulk-bg-level-0');
    });
});
