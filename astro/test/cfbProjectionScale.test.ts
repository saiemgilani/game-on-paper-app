import { describe, expect, test } from 'vitest';
import { calculatePredictedPointMargin, calculatePredictedWinProb } from '../src/resources/sdv';

// The CFB projection runs on the team summaries' net_adj_epa, so its constants are fitted
// to that rating ("gop_net_adj_epa" in cfbfastR-cfb-data models/pregame_fit.json). The
// sportsdataverse-py constants are fitted to cfb_ratings' wider adj_net. Pasting them in
// here compressed every projection about 1.7x, and these tests fail if that happens again.
describe('CFB projection scale', () => {
    test('a +0.2 net_adj_epa edge on a neutral field is about a 10-point favourite', () => {
        expect(calculatePredictedPointMargin(0.0, 0.2, true)).toBeCloseTo(9.69, 1);
    });

    test('equal teams at home get the fitted home edge', () => {
        expect(calculatePredictedPointMargin(0.1, 0.1, false)).toBeCloseTo(2.711, 3);
    });

    test('win probability prices the margin with the fitted spread', () => {
        // one fitted sd of margin -> Phi(1)
        expect(calculatePredictedWinProb(17.1697)).toBeCloseTo(0.8413, 3);
    });
});
