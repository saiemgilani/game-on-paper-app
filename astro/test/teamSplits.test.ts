import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { TEAM_SPLIT_ROWS, teamSplitColumns, teamSplitRows } from '../src/utils/teamSplits';

// The Data API's own 2025 team_tendencies rows, every column (fixtures/README.md):
// Alabama (cfb 333) and Kansas City (nfl 12).
const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/team-tendencies-${name}-2025.json`, import.meta.url)).toString()).data[0];
const rows = { cfb: fixture('cfb-333'), nfl: fixture('nfl-12') } as const;

const byKey = (league: 'cfb' | 'nfl', side: 'off' | 'def') =>
    Object.fromEntries(teamSplitRows(rows[league], side).map((r) => [r.key, r]));

describe.each(['cfb', 'nfl'] as const)('%s', (league) => {
    const row = rows[league];

    test('Overall is first and reads the bare columns', () => {
        const off = teamSplitRows(row, 'off')[0];
        expect(off.label).toBe('Overall');
        expect(off.plays).toBe(row.plays);
        expect(off.epa_per_play).toBe(row.epa_per_play);
        expect(off.pass_rate).toBe(row.pass_rate);
        expect(off.success_rate).toBe(row.success_rate);
        const def = teamSplitRows(row, 'def')[0];
        expect(def.plays).toBe(row.def_plays);
        expect(def.epa_per_play).toBe(row.def_epa_per_play);
    });

    test('Leading, Tied and Trailing partition Overall on both sides', () => {
        for (const side of ['off', 'def'] as const) {
            const r = byKey(league, side);
            expect(r.leading.plays! + r.tied.plays! + r.trailing.plays!, side).toBe(r.overall.plays);
            expect(r.own_half.plays! + r.opp_half.plays!, side).toBe(r.overall.plays);
        }
    });

    test('defense: Leading reads def_*_trailing and Trailing reads def_*_leading', () => {
        const r = byKey(league, 'def');
        expect(r.leading.plays).toBe(row.def_plays_trailing);
        expect(r.leading.epa_per_play).toBe(row.def_epa_per_play_trailing);
        expect(r.trailing.plays).toBe(row.def_plays_leading);
        expect(r.trailing.success_rate).toBe(row.def_success_rate_leading);
        expect(r.tied.pass_rate).toBe(row.def_pass_rate_tied);
    });

    test('defense: Own half reads def_*_opp_half and Opponent half reads def_*_own_half', () => {
        const r = byKey(league, 'def');
        expect(r.own_half.plays).toBe(row.def_plays_opp_half);
        expect(r.own_half.epa_per_play).toBe(row.def_epa_per_play_opp_half);
        expect(r.opp_half.plays).toBe(row.def_plays_own_half);
        expect(r.opp_half.success_rate).toBe(row.def_success_rate_own_half);
    });

    test('defense: downs, red zone, one score and context rows read the same-named def_ column', () => {
        const r = byKey(league, 'def');
        for (const k of ['d1', 'd2', 'd3_short', 'd3_medium', 'd3_long', 'd4', 'red_zone', 'one_score', 'home', 'away', 'neutral_site']) {
            expect(r[k].plays, k).toBe(row[`def_plays_${k}`]);
            expect(r[k].epa_per_play, k).toBe(row[`def_plays_${k}`] === 0 ? null : row[`def_epa_per_play_${k}`]);
        }
    });

    test('every select column exists in the real row (an unknown column is a 400 upstream)', () => {
        const keys = new Set(Object.keys(row));
        expect(teamSplitColumns(league).filter((c) => !keys.has(c))).toEqual([]);
    });
});

describe('league and zero-play rows', () => {
    test('cfb has 18 rows ending in vs Ranked; nfl has no vs Ranked column or row', () => {
        expect(teamSplitRows(rows.cfb, 'off')).toHaveLength(18);
        expect(teamSplitRows(rows.cfb, 'off').at(-1)?.label).toBe('vs Ranked');
        expect(teamSplitColumns('nfl').filter((c) => c.includes('vs_ranked'))).toEqual([]);
        expect(teamSplitRows(rows.nfl, 'off').map((r) => r.key)).not.toContain('vs_ranked');
        expect(teamSplitRows(rows.nfl, 'off')).toHaveLength(TEAM_SPLIT_ROWS.length - 1);
    });

    test('a split with zero plays keeps its row with null rates', () => {
        // a copy of the real row with its neutral-site split emptied; a stale rate must not leak through
        const r = Object.fromEntries(teamSplitRows({ ...rows.cfb, plays_neutral_site: 0, epa_per_play_neutral_site: 0.5 }, 'off').map((x) => [x.key, x]));
        expect(r.neutral_site.plays).toBe(0);
        expect(r.neutral_site).toMatchObject({ pass_rate: null, epa_per_play: null, success_rate: null });
    });

    test('no row, no rows', () => {
        expect(teamSplitRows(undefined, 'off')).toEqual([]);
    });
});
