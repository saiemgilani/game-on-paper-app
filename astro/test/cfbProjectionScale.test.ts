import { describe, expect, test } from 'vitest';
import { calculatePredictedPointMargin, calculatePredictedWinProb } from '../src/resources/sdv';

// The CFB projection runs on the team summaries' net_adj_epa, so its constants are fitted
// to that rating ("gop_net_adj_epa" in cfbfastR-cfb-data models/pregame_fit.json). A scale
// fitted to a different rating once compressed every projection about 1.7x. These tests pin
// the fitted scale, home edge and spread, so a constant pasted in from elsewhere fails here.
describe('CFB projection scale', () => {
    test('a +0.2 net_adj_epa edge on a neutral field is about an 8-point favourite', () => {
        expect(calculatePredictedPointMargin(0.0, 0.2, true)).toBeCloseTo(8.07, 1);
    });

    test('equal teams at home get the fitted home edge', () => {
        expect(calculatePredictedPointMargin(0.1, 0.1, false)).toBeCloseTo(2.7625, 3);
    });

    test('win probability prices the margin with the fitted spread', () => {
        // one fitted sd of margin -> Phi(1)
        expect(calculatePredictedWinProb(17.1504)).toBeCloseTo(0.8413, 3);
    });
});

// The CFB refit must not reach the NFL. The NFL has no fitted constants yet, so it gets no
// projection at all (margin or win probability) until it has its own fit.
describe('NFL gets no projection', () => {
    test('no margin, even with both ratings present', () => {
        expect(calculatePredictedPointMargin(0.0, 0.2, true, 'nfl')).toBeNull();
        expect(calculatePredictedPointMargin(0.1, 0.1, false, 'nfl')).toBeNull();
    });

    test('no win probability, even for a finite margin', () => {
        expect(calculatePredictedWinProb(18.7894, 'nfl')).toBeNull();
    });

    test('CFB is the default league', () => {
        expect(calculatePredictedPointMargin(0.0, 0.2, true)).toBe(calculatePredictedPointMargin(0.0, 0.2, true, 'cfb'));
        expect(calculatePredictedWinProb(10)).toBe(calculatePredictedWinProb(10, 'cfb'));
    });
});
