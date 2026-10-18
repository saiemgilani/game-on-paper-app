import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { getPercentileKey, teamSeasonBandsFor } from '../src/utils/misc';
import { teamSeasonBands } from '../src/resources/sdv';

// The team trend chart's metric -> the team-game ladder column its bands come from
// (`cfb.percentiles` / `nfl.percentiles`). Audit A7, 2026-10-08.
describe('team trend band keys', () => {
    test('Pass SR% reads the pass-success ladder', () => {
        // `case "success_pas"` never matched, so Pass SR% drew no bands
        expect(getPercentileKey('success_off_pass')).toBe('pass_success');
        expect(getPercentileKey('success_def_pass')).toBe('pass_success');
        expect(getPercentileKey('success_off_rush')).toBe('rush_success');
        expect(getPercentileKey('EPAplay_def_pass')).toBe('EPAdropback');
    });

    test('a margin is not a level, so it maps to no ladder column', () => {
        // stripping `_margin` drew EPA/play margins (centered on 0) over EPA/play
        // level bands (median 0.054)
        for (const m of ['EPAplay_margin', 'success_margin', 'yardsplay_margin']) {
            expect(getPercentileKey(m), m).toBe(m);
        }
        expect(getPercentileKey('EPAplay_off')).toBe('EPAplay');
    });
});

// 'team-season-bands': the rows are the team-SEASON distribution keyed by the team_summaries column itself,
// so the chart filters by metric -- margins included (Net Statistics get boxes), no ladder key in between.
describe('team-season band filter', () => {
    const body = JSON.parse(readFileSync(new URL('./fixtures/team-season-percentiles-cfb.json', import.meta.url)).toString());
    const rows = teamSeasonBands(body.data);

    test('a metric gets its own five points per season and nothing else', () => {
        const pts = teamSeasonBandsFor(rows, 'success_off_pass');
        expect(pts).toHaveLength(3 * 5);
        expect(new Set(pts.map(p => p.season))).toEqual(new Set([2023, 2024, 2025]));
        expect(Object.keys(pts[0]).sort()).toEqual(['pctile', 'season', 'value']);
    });

    test('a margin draws bands centred near 0, from its own rows', () => {
        const median = teamSeasonBandsFor(rows, 'EPAplay_margin').find(p => p.season === 2024 && p.pctile === 0.5)!;
        expect(Math.abs(median.value)).toBeLessThan(0.05);
        expect(teamSeasonBandsFor(rows, 'net_adj_epa')).toEqual([]); // trimmed out of the fixture: no rows, no bands
    });
});
