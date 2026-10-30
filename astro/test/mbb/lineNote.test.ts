// D33 / D39 (R12, ruling R11): "No line in the warehouse" only for an ingested (Data API) final from the first season ESPN publishes
// MBB lines; the processor path, earlier seasons and every league without linesFromSeason keep "No line" (NBA/WNBA byte-identical).
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, noLineText } from '../../src/basketball/config';

const LINES: { linesFromSeason: number } = JSON.parse(readFileSync(new URL('../fixtures/mbb/lines_by_season.json', import.meta.url)).toString());

describe('the no-line copy (D33, D39)', () => {
    test('the cutoff is the measured first lined season', () => {
        expect(BASKETBALL.mbb.linesFromSeason).toBe(LINES.linesFromSeason);
        expect(LINES.linesFromSeason).toBe(2013);
        for (const lg of ['nba', 'wnba'] as const) expect(Object.keys(BASKETBALL[lg])).not.toContain('linesFromSeason');
    });
    test('an ingested final from 2012-13 on: the line is not in the warehouse; earlier or seasonless: "No line"', () => {
        expect(noLineText('mbb', 2026, 'data_api')).toBe('No line in the warehouse'); // 401808271's season
        expect(noLineText('mbb', 2013, 'data_api')).toBe('No line in the warehouse'); // the first lined season
        expect(noLineText('mbb', 2012, 'data_api')).toBe('No line');                  // ESPN had no lines
        expect(noLineText('mbb', null, 'data_api')).toBe('No line');
        expect(noLineText('mbb', 2026, 'processor')).toBe('No line');                 // ESPN's own summary had none
    });
    test('the NBA and WNBA keep "No line" in every case', () => {
        for (const lg of ['nba', 'wnba'] as const) for (const src of ['data_api', 'processor'] as const) expect(noLineText(lg, 2025, src)).toBe('No line');
    });
});
