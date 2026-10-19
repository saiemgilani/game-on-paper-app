// astro/test/basketball/court.test.ts
import { describe, expect, test } from 'vitest';
import { COURT, THREE_BREAK_Y, courtLines, threeBreakY, viewport, zoneAreas, zoneLines } from '../../src/nba/data/court';
import { describeShots, onDrawnCourt } from '../../src/nba/charts/gameShotChart';

// a 22.15 ft arc (spec §3.3, the WNBA from 2013 and the NCAA from 2019-20/2021-22): a literal court, no provider data
const ARC_2215 = { ...COURT, threeRadius: 221.5 };
const v = viewport(500, 350, 25);

describe('the court is a parameter; the NBA court is the default', () => {
    test('defaults equal explicit COURT', () => {
        expect(courtLines(v, COURT)).toEqual(courtLines(v));
        expect(zoneLines(v, COURT)).toEqual(zoneLines(v));
        expect(zoneAreas(v, COURT)).toEqual(zoneAreas(v));
        expect(threeBreakY(COURT)).toBe(THREE_BREAK_Y);
    });
    test('a shorter arc moves only the three-point line and the corner breaks', () => {
        const a = Object.fromEntries(courtLines(v).map((l) => [l.name, l.d]));
        const b = Object.fromEntries(courtLines(v, ARC_2215).map((l) => [l.name, l.d]));
        for (const name of Object.keys(a)) expect(b[name] === a[name]).toBe(name !== 'three-point-line');
        expect(threeBreakY(ARC_2215)).toBeLessThan(THREE_BREAK_Y);
    });
    test('game shot chart helpers take the court', () => {
        const s = { x: 0, y: 300, made: true, value: 3, label: 'x', period: 1 };
        expect(onDrawnCourt(s, COURT)).toBe(onDrawnCourt(s));
        expect(describeShots([s], COURT)).toBe(describeShots([s]));
    });
});
