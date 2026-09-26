import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { neighborWindow, playerKey, teamKey } from '../src/utils/neighbors';

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
