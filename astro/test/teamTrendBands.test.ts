import { describe, expect, test } from 'vitest';
import { getPercentileKey } from '../src/utils/misc';

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
        // stripping `_margin` drew EPA/play margins (centred on 0) over EPA/play
        // level bands (median 0.054)
        for (const m of ['EPAplay_margin', 'success_margin', 'yardsplay_margin']) {
            expect(getPercentileKey(m), m).toBe(m);
        }
        expect(getPercentileKey('EPAplay_off')).toBe('EPAplay');
    });
});
