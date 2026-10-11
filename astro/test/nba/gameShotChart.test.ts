import { describe, expect, test } from 'vitest';
import { describeShots, shotMarks, GAME_SHOT_VIEWBOX, type GameShot } from '../../src/nba/charts/gameShotChart';
import { courtViewport } from '../../src/nba/charts/court';

const shots: GameShot[] = [
    { x: 0, y: 0, made: true, value: 2, label: 'dunk', period: 1 },
    { x: -220, y: 0, made: false, value: 3, label: 'corner three', period: 4 },
];
describe('gameShotChart', () => {
    test('marks land where toSvg puts them and distinguish made from missed', () => {
        const v = courtViewport(500);
        const m = shotMarks(shots, v);
        expect(m[0].made && !m[1].made).toBe(true);
        expect(m[1].cx).toBeLessThan(m[0].cx);
        expect(m[0].cy).toBeCloseTo(v.top * v.scale, 3);
    });
    test('describeShots counts makes and threes', () => {
        expect(describeShots(shots)).toBe('1 of 2 field goals made, 0 of 1 threes');
    });
    test('the viewBox is the court', () => {
        expect(GAME_SHOT_VIEWBOX.height).toBe(courtViewport().height);
    });
});
