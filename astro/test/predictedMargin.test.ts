import { describe, expect, test } from 'vitest';
import { calculatePredictedPointMargin, calculatePredictedWinProb } from '../src/resources/sdv';

describe('calculatePredictedPointMargin', () => {
    test('projects CFB games from the CFB-fitted constants', () => {
        const m = calculatePredictedPointMargin(0.05, 0.2, false, 'cfb');
        expect(m).not.toBeNull();
        expect(m!).toBeGreaterThan(0);
        expect(calculatePredictedWinProb(m)).toBeGreaterThan(0.5);
    });

    test('defaults to CFB so existing callers keep their projection', () => {
        expect(calculatePredictedPointMargin(0.05, 0.2, false)).toBe(calculatePredictedPointMargin(0.05, 0.2, false, 'cfb'));
    });

    test('gives no projection for the NFL until NFL-fitted constants exist', () => {
        const m = calculatePredictedPointMargin(0.05, 0.2, false, 'nfl');
        expect(m).toBeNull();
        expect(calculatePredictedWinProb(m)).toBeNull();
    });
});
