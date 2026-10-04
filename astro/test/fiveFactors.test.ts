import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FIVE_FACTORS, fiveFactorColumns } from '../src/utils/fiveFactors';
import { METRIC_FORMATS, formatMetricValue } from '../src/utils/misc';

// Both fixtures are the Data API's own 2025 team_summaries bodies, trimmed by
// `select` to the columns the Five Factors table reads (see fixtures/README.md).
const fixture = (league: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/team-summaries-${league}-2025.json`, import.meta.url)).toString()).data;

describe('FIVE_FACTORS', () => {
    test('ten rows: the five factors, four of them followed by a sub-row', () => {
        expect(FIVE_FACTORS.map((f) => f.label)).toEqual([
            'Efficiency', 'Explosiveness', 'Field Position', 'Start (yds)', 'Finishing Drives',
            'Turnovers', 'Expected', 'Luck (pts)', 'Havoc', 'EPA / Game',
        ]);
        expect(FIVE_FACTORS.filter((f) => f.sub).map((f) => f.label)).toEqual(['Start (yds)', 'Expected', 'Luck (pts)', 'EPA / Game']);
        // every row names its metric for the column beside the label, and formats
        // through the site's one spec in misc.ts
        for (const f of FIVE_FACTORS) {
            expect(f.metric, f.label).toMatch(/\S/);
            expect(f.metric, f.label).not.toContain('·');
            expect(Object.keys(METRIC_FORMATS), f.label).toContain(f.format);
        }
    });

    test('the metric copy Akshay set on #284', () => {
        const byLabel = Object.fromEntries(FIVE_FACTORS.map((f) => [f.label, f]));
        expect(byLabel['Turnovers'].metric).toBe('Giveaways or Takeaways per game');
        expect(byLabel['Field Position'].metric).toBe('Avg expected points based on drive start yardline');
        // drive start prints as a yardline ("Own 28"), as the game page's box score does
        expect(byLabel['Start (yds)'].format).toBe('yardline');
    });

    test('field position reads drive_start_ep_* with start_position_* beneath it; havoc has a margin', () => {
        const byLabel = Object.fromEntries(FIVE_FACTORS.map((f) => [f.label, f]));
        expect(byLabel['Field Position']).toMatchObject({ off: 'drive_start_ep_off', def: 'drive_start_ep_def', margin: 'drive_start_ep_margin' });
        expect(byLabel['Start (yds)']).toMatchObject({ off: 'start_position_off', def: 'start_position_def', margin: 'start_position_margin' });
        expect(byLabel['Luck (pts)']).toMatchObject({ off: 'turnover_luck_off', def: 'turnover_luck_def', margin: 'turnover_luck' });
        expect(byLabel['Havoc'].margin).toBe('havoc_margin');
        expect(byLabel['Explosiveness'].margin).toBe('explosive_margin');
    });

    test.each(['cfb', 'nfl'])('every key and its _rank is in the %s 2025 fixture', (league) => {
        const rows = fixture(league);
        expect(rows.length).toBe(league === 'cfb' ? 136 : 32);
        for (const f of FIVE_FACTORS) {
            for (const k of [f.off, f.def, f.margin].filter((c): c is string => c !== null)) {
                expect(rows[0], k).toHaveProperty(k);
                expect(rows[0], `${k}_rank`).toHaveProperty(`${k}_rank`);
            }
        }
    });
});

describe('fiveFactorColumns', () => {
    test('the 30 value columns and nothing else', () => {
        const cols = fiveFactorColumns();
        expect(new Set(cols).size).toBe(30);
        expect(cols).toEqual(FIVE_FACTORS.flatMap((f) => [f.off, f.def, f.margin]));
        // retrieveTeamSummaries appends `_rank` to every column it is handed, and
        // one unknown column in `select` (a `_rank_rank`) is a 400 from the API
        expect(cols.filter((c) => c.endsWith('_rank'))).toEqual([]);
    });
});

describe('formatMetricValue', () => {
    test('rates render as percentages, counts through roundNumber, margins signed', () => {
        expect(formatMetricValue(0.43973214285714285, 'pct')).toBe('44.0%');
        expect(formatMetricValue(0.006124622293100568, 'pct', true)).toBe('+0.6%');
        expect(formatMetricValue(73.63839285714286, 'num1')).toBe('73.6');
        expect(formatMetricValue(-1.5032577220077314, 'num1', true)).toBe('-1.5');
        expect(formatMetricValue(4.2405063291139244, 'num2')).toBe('4.24');
        expect(formatMetricValue(0.5714285714285715, 'num2', true)).toBe('+0.57');
        expect(formatMetricValue(0, 'num2', true)).toBe('+0.00');
    });

    test('a yardline (yards to goal) prints as TeamMetricsTable does: Own at 50 and beyond, Opp inside', () => {
        // Alabama's 2025 start_position_off / _def, and a drive that starts in opponent territory
        expect(formatMetricValue(71.91724137931034, 'yardline')).toBe('Own 28');
        expect(formatMetricValue(71.66447368421052, 'yardline')).toBe('Own 28');
        expect(formatMetricValue(50, 'yardline')).toBe('Own 50');
        expect(formatMetricValue(44.4, 'yardline')).toBe('Opp 44');
        expect(formatMetricValue('62.5', 'yardline')).toBe('Own 38');
        // a margin is a distance, not a spot: signed yards, one decimal, no Own/Opp
        expect(formatMetricValue(-0.2527676950998199, 'yardline', true)).toBe('-0.3');
        expect(formatMetricValue(0.33128834355828474, 'yardline', true)).toBe('+0.3');
    });

    test('a missing value is an em dash, never 0', () => {
        for (const v of [null, undefined, '', 'NA', NaN]) {
            expect(formatMetricValue(v, 'pct')).toBe('—');
            expect(formatMetricValue(v, 'num2', true)).toBe('—');
            expect(formatMetricValue(v, 'yardline')).toBe('—');
        }
    });
});
