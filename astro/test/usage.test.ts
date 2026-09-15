import { describe, expect, test } from 'vitest';
import { hasSituationalSplits, hasUsageBox, madeOf, num, pct, scriptSplit, signed, sortDesc, teamRows } from '../src/utils/usage';

describe('usage box helpers', () => {
    test('hasUsageBox needs at least one populated section', () => {
        expect(hasUsageBox(null)).toBe(false);
        expect(hasUsageBox({} as any)).toBe(false);
        expect(hasUsageBox({ player_usage: [] } as any)).toBe(false);
        expect(hasUsageBox({ st_punters: [{ pos_team: 1 }] } as any)).toBe(true);
        // every emitted section counts, team-level special teams included
        expect(hasUsageBox({ st_team: [{ pos_team: 1 }] } as any)).toBe(true);
        expect(hasUsageBox({ position_group_usage: [{ pos_team: 1 }] } as any)).toBe(true);
    });
    test('hasSituationalSplits needs a section the two-team panel reads', () => {
        expect(hasSituationalSplits({ player_usage: [{ pos_team: 1 }], tackles: [{ def_pos_team: 1 }] } as any)).toBe(false);
        expect(hasSituationalSplits({ st_team: [{ pos_team: 1 }] } as any)).toBe(true);
        expect(hasSituationalSplits({ drive_scripting: [{ pos_team: 1, script: 'scripted' }] } as any)).toBe(true);
        expect(hasSituationalSplits(undefined)).toBe(false);
    });
    test('teamRows compares ids as strings and tolerates missing rows', () => {
        const rows = [{ pos_team: 21, x: 1 }, { pos_team: 6, x: 2 }];
        expect(teamRows(rows, '21')).toEqual([{ pos_team: 21, x: 1 }]);
        expect(teamRows(undefined, 21)).toEqual([]);
        expect(teamRows([{ def_pos_team: 6 }], 6, 'def_pos_team')).toHaveLength(1);
    });
    test('sortDesc puts nulls last and breaks ties on the name', () => {
        const rows = [
            { player_name: 'B', v: 1 }, { player_name: 'A', v: 1 }, { player_name: 'C', v: null }, { player_name: 'D', v: 3 },
        ];
        expect(sortDesc(rows, 'v').map((r) => r.player_name)).toEqual(['D', 'A', 'B', 'C']);
    });
    test('formatters', () => {
        expect(pct(0.4123)).toBe('41.2%');
        expect(pct(null)).toBe('—');
        expect(signed(1.44)).toBe('+1.4');
        expect(signed(-0.61)).toBe('-0.6');
        expect(signed(0)).toBe('0.0');
        expect(num(45.25, 1)).toBe('45.3');
        expect(madeOf(2, 3)).toBe('2/3');
        expect(madeOf(null, undefined)).toBe('0/0');
    });
    test('scriptSplit picks both windows for a team', () => {
        const rows = [
            { pos_team: 1, script: 'scripted', drives: 4 }, { pos_team: 1, script: 'non_scripted', drives: 8 }, { pos_team: 2, script: 'scripted', drives: 3 },
        ];
        const s = scriptSplit(rows, 1);
        expect(s.scripted?.drives).toBe(4);
        expect(s.non_scripted?.drives).toBe(8);
        expect(scriptSplit(rows, 9).scripted).toBeUndefined();
    });
});
