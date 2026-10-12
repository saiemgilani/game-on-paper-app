// @vitest-environment jsdom
// Every court-taking helper must USE the court it is given: each assertion here compares a non-NBA court against the
// default, so ignoring the parameter (falling back to COURT or THREE_BREAK_Y) turns it red.
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { COURT, THREE_BREAK_Y, threeBreakY, viewport, zoneAreas, zoneLines } from '../../src/nba/data/court';
import { COURT_PAD } from '../../src/nba/charts/court';
import { describeShots, onDrawnCourt, renderGameShotChart, type GameShot } from '../../src/nba/charts/gameShotChart';
import { fromProcessor } from '../../src/resources/nbaGame';
import { shotsOf } from '../../src/nba/data/game';
import type { Court } from '../../src/basketball/config';

// the 22.15 ft arc of court.test.ts (spec §3.3: the WNBA from 2013, the NCAA from 2019-20/2021-22)
const ARC_2215 = { ...COURT, threeRadius: 221.5 };
const v = viewport(500, 350, 25);
const byName = <T extends { name: string; d: string }>(ls: T[]) => Object.fromEntries(ls.map((l) => [l.name, l.d]));

describe('zone geometry follows the court', () => {
    test('zoneLines: the corner breaks and the arc move; the paint and the restricted arc do not', () => {
        expect(threeBreakY(ARC_2215)).not.toBe(THREE_BREAK_Y);
        const a = byName(zoneLines(v)), b = byName(zoneLines(v, ARC_2215));
        expect(Object.keys(b)).toEqual(Object.keys(a));
        for (const n of ['corner-break-left', 'corner-break-right', 'three-point-line']) expect(b[n]).not.toBe(a[n]);
        for (const n of ['paint', 'restricted-area']) expect(b[n]).toBe(a[n]);
    });
    test('zoneAreas: the corners and the above-break area move; the rim and paint areas do not', () => {
        const a = Object.fromEntries(zoneAreas(v).map((z) => [z.zone, z.d]));
        const b = Object.fromEntries(zoneAreas(v, ARC_2215).map((z) => [z.zone, z.d]));
        for (const z of ['corner_3_left', 'corner_3_right', 'above_break_3', 'mid_range']) expect(b[z]).not.toBe(a[z]);
        for (const z of ['restricted_area', 'paint']) expect(b[z]).toBe(a[z]);
    });
});

describe('the game shot chart honours the court on a real shot', () => {
    const game = fromProcessor(JSON.parse(readFileSync('test/fixtures/nba/game_401766458_processor.json').toString()));
    const shots: GameShot[] = shotsOf(game.plays, Number(game.home.team.id)).map((p) => ({
        x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || (/three point/i.test(p.text) ? 3 : 2), label: p.text, period: p.period }));
    // the widest real attempt (Caldwell-Pope's corner three at x = -240), and a probe court one tenth too narrow to keep it
    const wide = shots.reduce((m, s) => (Math.abs(s.x) > Math.abs(m.x) ? s : m));
    const NARROW = { ...COURT, halfWidth: Math.abs(wide.x) - COURT_PAD - 1 };

    test('onDrawnCourt and describeShots', () => {
        expect(onDrawnCourt(wide)).toBe(true);
        expect(onDrawnCourt(wide, NARROW)).toBe(false);
        expect(describeShots([wide])).not.toContain('not shown');
        expect(describeShots([wide], NARROW)).toContain('1 from beyond the drawn court not shown');
    });
    test('renderGameShotChart marks only the shots on the given court and draws its lines', () => {
        const draw = (court?: Court) => {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            renderGameShotChart(svg, shots, { width: 500, court });
            return svg;
        };
        const marks = (svg: SVGSVGElement) => svg.querySelectorAll('.made circle').length + svg.querySelectorAll('.missed path').length;
        const lines = (svg: SVGSVGElement) => [...svg.querySelectorAll('.court path')].map((p) => p.getAttribute('d'));
        const kept = shots.filter((s) => onDrawnCourt(s, NARROW)).length;
        expect(kept).toBeLessThan(shots.filter((s) => onDrawnCourt(s)).length);
        expect(marks(draw(NARROW))).toBe(kept);
        expect(lines(draw(ARC_2215))).not.toEqual(lines(draw()));
    });
});
