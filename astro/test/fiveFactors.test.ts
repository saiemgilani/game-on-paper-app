import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FIVE_FACTORS, fiveFactorColumns, formatFactor } from '../src/utils/fiveFactors';

// Both fixtures are the Data API's own 2025 team_summaries bodies, trimmed by
// `select` to the columns the Five Factors table reads (see fixtures/README.md).
const fixture = (league: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/team-summaries-${league}-2025.json`, import.meta.url)).toString()).data;

describe('FIVE_FACTORS', () => {
    test('five rows, each an offense/defense/margin triple', () => {
        expect(FIVE_FACTORS.map((f) => f.label)).toEqual(['Efficiency', 'Explosiveness', 'Field Position', 'Finishing Drives', 'Turnovers']);
    });

    test('the field-position row reads start_position_*, the explosiveness margin reads explosive_margin', () => {
        const byLabel = Object.fromEntries(FIVE_FACTORS.map((f) => [f.label, f]));
        expect(byLabel['Field Position']).toMatchObject({ off: 'start_position_off', def: 'start_position_def', margin: 'start_position_margin' });
        expect(byLabel['Explosiveness'].margin).toBe('explosive_margin');
    });

    test.each(['cfb', 'nfl'])('every key and its _rank is in the %s 2025 fixture', (league) => {
        const rows = fixture(league);
        expect(rows.length).toBe(league === 'cfb' ? 136 : 32);
        for (const f of FIVE_FACTORS) {
            for (const k of [f.off, f.def, f.margin]) {
                expect(rows[0], k).toHaveProperty(k);
                expect(rows[0], `${k}_rank`).toHaveProperty(`${k}_rank`);
            }
        }
    });
});

describe('fiveFactorColumns', () => {
    test('the 15 value columns and nothing else', () => {
        const cols = fiveFactorColumns();
        expect(new Set(cols).size).toBe(15);
        expect(cols).toEqual(FIVE_FACTORS.flatMap((f) => [f.off, f.def, f.margin]));
        // retrieveTeamSummaries appends `_rank` to every column it is handed, and
        // one unknown column in `select` (a `_rank_rank`) is a 400 from the API
        expect(cols.filter((c) => c.endsWith('_rank'))).toEqual([]);
    });
});

describe('formatFactor', () => {
    test('rates render as percentages, counts through roundNumber, margins signed', () => {
        expect(formatFactor(0.43973214285714285, 'pct')).toBe('44.0%');
        expect(formatFactor(0.006124622293100568, 'pct', true)).toBe('+0.6%');
        expect(formatFactor(73.63839285714286, 'num1')).toBe('73.6');
        expect(formatFactor(-1.5032577220077314, 'num1', true)).toBe('-1.5');
        expect(formatFactor(4.2405063291139244, 'num2')).toBe('4.24');
        expect(formatFactor(0.5714285714285715, 'num2', true)).toBe('+0.57');
        expect(formatFactor(0, 'num2', true)).toBe('+0.00');
    });

    test('a missing value is an em dash, never 0', () => {
        for (const v of [null, undefined, '', 'NA', NaN]) {
            expect(formatFactor(v, 'pct')).toBe('—');
            expect(formatFactor(v, 'num2', true)).toBe('—');
        }
    });
});
