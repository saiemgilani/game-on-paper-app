// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { describeShots, onDrawnCourt, renderGameShotChart, shotMarks, GAME_SHOT_VIEWBOX, type GameShot } from '../../src/nba/charts/gameShotChart';
import { fromProcessor } from '../../src/resources/nbaGame';
import { shotsOf } from '../../src/nba/data/game';
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

describe('renderGameShotChart on the real fixture', () => {
    const game = fromProcessor(JSON.parse(readFileSync('test/fixtures/nba/game_401766458_processor.json').toString()));
    const toShots = (teamId: string): GameShot[] => shotsOf(game.plays, Number(teamId)).map((p) => ({
        x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || (/three point/i.test(p.text) ? 3 : 2), label: p.text, period: p.period }));
    test('the viewBox height is the viewport height, and only shots on the drawn court get a mark', () => {
        for (const width of [340, 500, 900]) {
            const shots = toShots(game.home.team.id);
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            renderGameShotChart(svg, shots, { width });
            const v = courtViewport(width);
            expect(svg.getAttribute('viewBox')).toBe(`0 0 ${width} ${Math.ceil(v.height)}`);
            const on = shots.filter(onDrawnCourt);
            expect(svg.querySelectorAll('.made circle').length).toBe(on.filter((s) => s.made).length);
            expect(svg.querySelectorAll('.missed path').length).toBe(on.filter((s) => !s.made).length);
            expect(svg.querySelectorAll('text').length).toBe(0); // nothing drawn past the sideline
        }
    });
    test('a heave from past the drawn court is dropped and counted in the summary', () => {
        const heave: GameShot = { x: 0, y: 700, made: false, value: 3, label: 'heave', period: 4 };
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        renderGameShotChart(svg, [heave, shots[0]], { width: 500 });
        expect(svg.querySelectorAll('.made circle').length + svg.querySelectorAll('.missed path').length).toBe(1);
        expect(describeShots([heave, shots[0]])).toBe('1 of 2 field goals made, 0 of 1 threes; 1 from beyond the drawn court not shown');
    });
});
