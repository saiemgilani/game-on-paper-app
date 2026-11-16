// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { describeShots, gameShotsLite, onDrawnCourt, renderGameShotChart, shotMarks, GAME_SHOT_VIEWBOX, type GameShot, type ShotMark } from '../../src/nba/charts/gameShotChart';
import { renderDistanceBars } from '../../src/nba/charts/distanceBars';
import { distanceCharts } from '../../src/nba/dashboard';
import { leagueContextFromRows } from '../../src/nba/adapters';
import { toSvgLength } from '../../src/nba/data/court';
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
    const game = fromProcessor(JSON.parse(readFileSync('test/fixtures/nba/game_401766458_processor.json').toString()), 'nba');
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

// BB-G39: on the game page each team's shot chart, signature and FG% bars share one `data-shot-link` dashboard
describe('the game shot chart, linked (BB-G39)', () => {
    const game = fromProcessor(JSON.parse(readFileSync('test/fixtures/nba/game_401766458_processor.json').toString()), 'nba');
    const shots: GameShot[] = shotsOf(game.plays, Number(game.home.team.id)).map((p) => ({
        x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || 2, label: p.text, period: p.period }));
    const context = leagueContextFromRows(JSON.parse(readFileSync('test/fixtures/wnba/dashboards/league_context_2026.json').toString()));
    const svgIn = (hub: Element) => hub.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement);
    const marks = (svg: SVGSVGElement) => [...svg.querySelectorAll<SVGElement>('.made circle, .missed path')];
    const ftOf = (el: SVGElement) => ((el as any).__data__ as ShotMark).ft;
    const setup = () => {
        (SVGElement.prototype as any).getBBox ??= () => ({ x: 0, y: 0, width: 40, height: 12 });
        const hub = document.body.appendChild(document.createElement('div'));
        hub.setAttribute('data-shot-link', '');
        const court = svgIn(hub), bars = svgIn(hub);
        const { bars: data } = distanceCharts(gameShotsLite(shots, game.id), context);
        renderGameShotChart(court, shots, { width: 500 });
        renderDistanceBars(bars, data, { metric: 'fgPct', width: 500, animate: false, pinnable: true });
        const targets = [...bars.querySelectorAll<SVGRectElement>('g > rect')].filter((r) => r.style.fill === 'transparent');
        const ring = court.querySelector<SVGCircleElement>(':scope > g > circle')!;
        return { hub, court, bars, targets, ring };
    };
    test('hovering a bar rings its distance and fades every shot outside the bin', () => {
        const { hub, court, targets, ring } = setup();
        expect(ring.style.display).toBe('none');
        targets[1].dispatchEvent(new Event('pointerenter')); // 3-5 ft
        expect(ring.style.display).toBe('inline');
        expect(Number(ring.getAttribute('r'))).toBeCloseTo(toSvgLength(40, courtViewport(500)), 6);
        const lit = marks(court).filter((m) => m.style.opacity === '');
        expect(lit.length).toBeGreaterThan(0);
        for (const m of marks(court)) expect(m.style.opacity).toBe(ftOf(m) >= 3 && ftOf(m) <= 5 ? '' : '0.12');
        targets[1].dispatchEvent(new Event('pointerleave'));
        expect(ring.style.display).toBe('none');
        expect(marks(court).every((m) => m.style.opacity === '')).toBe(true);
        hub.remove();
    });
    test('a clicked bar holds through the pointer leaving, a hovered shot cannot move it, a second click lets go', () => {
        const { hub, court, bars, targets, ring } = setup();
        targets[0].dispatchEvent(new Event('pointerenter'));
        targets[0].dispatchEvent(new Event('click')); // 0-2 ft
        targets[0].dispatchEvent(new Event('pointerleave'));
        expect(ring.style.display).toBe('inline');
        const outline = [...bars.querySelectorAll<SVGRectElement>('rect[pointer-events="none"]')][0];
        expect(outline.style.display).toBe('inline');
        const far = marks(court).find((m) => ftOf(m) > 20)!;
        far.dispatchEvent(new Event('pointerenter')); // the chart's own hover is held off by the pin
        expect(far.style.opacity).toBe('0.12');
        targets[0].dispatchEvent(new Event('click'));
        targets[0].dispatchEvent(new Event('pointerleave'));
        expect(ring.style.display).toBe('none');
        expect(outline.style.display).toBe('none');
        hub.remove();
    });
    test('hovering a shot outlines its bin on the bars', () => {
        const { hub, court, bars } = setup();
        const shot = marks(court).find((m) => ftOf(m) >= 24 && ftOf(m) <= 26)!;
        shot.dispatchEvent(new Event('pointerenter'));
        const outline = [...bars.querySelectorAll<SVGRectElement>('rect[pointer-events="none"]')][0];
        expect(outline.style.display).toBe('inline');
        shot.dispatchEvent(new Event('pointerleave'));
        expect(outline.style.display).toBe('none');
        hub.remove();
    });
    test('outside a dashboard (the flag off) nothing links and nothing fades', () => {
        const svg = document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement);
        renderGameShotChart(svg, shots, { width: 500 });
        marks(svg)[0].dispatchEvent(new Event('pointerenter'));
        expect(marks(svg).every((m) => m.style.opacity === '')).toBe(true);
        svg.remove();
    });
});
