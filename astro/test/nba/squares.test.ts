// @vitest-environment jsdom
// Square bins (sdvplot-js's lattice), the league squares rebuilt from the league's hexes, and the distance link between charts.
import { describe, expect, test } from 'vitest';
import { renderDistanceBars } from '../../src/nba/charts/distanceBars';
import { MIN_DRAWN_ATTEMPTS, renderHexShotChart, SQUARE_FILL } from '../../src/nba/charts/hexShotChart';
import { courtViewport } from '../../src/nba/charts/court';
import { toSvgLength } from '../../src/nba/data/court';
import { emitDistance, onDistance } from '../../src/nba/charts/link';
import { renderShootingSignature } from '../../src/nba/charts/shootingSignature';
import { buildDashboard, HEX_RADIUS, leagueContext, SQUARE_SIDE } from '../../src/nba/dashboard';
import { leagueHexIndex, leagueSquares, squarebinShots, squaresVsLeague } from '../../src/nba/data/aggregate';
import type { ShotLite } from '../../src/nba/data/shots';
import { readFileSync } from 'node:fs';

// read from the package root: under jsdom, import.meta.url does not resolve to the file
const fixtureShots = async (): Promise<ShotLite[]> => JSON.parse(readFileSync('test/fixtures/nba/shots.json', 'utf-8'));

const shot = (x: number, y: number, made: boolean): ShotLite =>
    ({ x_legacy: x, y_legacy: y, shot_result: made ? 'Made' : 'Missed', shot_value: 2, shot_distance: Math.round(Math.hypot(x, y) / 10) }) as ShotLite;

describe('squarebinShots', () => {
    test('cells sit on the hoop lattice, so the rim is a cell centre, and an edge goes to the higher cell', () => {
        const cells = squarebinShots([shot(0, 0, true), shot(12, -12, false), shot(12.5, 0, true), shot(-237, 30, false)], 25);
        const at = (x: number, y: number) => cells.find((c) => c.x === x && c.y === y);
        expect(at(0, 0)).toMatchObject({ attempts: 2, makes: 1 });
        expect(at(25, 0)).toMatchObject({ attempts: 1, makes: 1 });
        expect(at(-225, 25)).toMatchObject({ attempts: 1, makes: 0 });
        expect(cells.reduce((a, c) => a + c.attempts, 0)).toBe(4);
    });
});

describe('leagueSquares', () => {
    test('keeps every league attempt and make, and lands near the squares binned from the shots themselves', async () => {
        const shots = await fixtureShots();
        const index = leagueHexIndex(shots, HEX_RADIUS);
        const derived = leagueSquares(index, SQUARE_SIDE);
        const sum = (xs: { attempts: number; fgPct: number | null }[], f: (x: { attempts: number; fgPct: number | null }) => number) => xs.reduce((a, x) => a + f(x), 0);
        expect(sum(derived, (c) => c.attempts)).toBeCloseTo(sum(index.hexes, (h) => h.attempts), 6);
        expect(sum(derived, (c) => c.attempts * (c.fgPct ?? 0))).toBeCloseTo(sum(index.hexes, (h) => h.attempts * (h.fgPct ?? 0)), 6);
        // against the exact squares: busy squares agree on FG% to a few points on average (the hexes straddle square edges)
        const exact = new Map(squarebinShots(shots, SQUARE_SIDE).map((c) => [`${c.x},${c.y}`, c]));
        const busy = derived.filter((c) => c.attempts >= 25 && (exact.get(`${c.x},${c.y}`)?.attempts ?? 0) >= 25);
        expect(busy.length).toBeGreaterThan(5);
        const gap = busy.reduce((a, c) => a + Math.abs(c.fgPct! - exact.get(`${c.x},${c.y}`)!.fgPct!), 0) / busy.length;
        expect(gap).toBeLessThan(0.05);
    });

    test('a square the league rarely shot from falls back to the zone rate', async () => {
        const shots = await fixtureShots();
        const index = leagueHexIndex(shots, HEX_RADIUS);
        const heave = squaresVsLeague([shot(0, 340, false)], index, SQUARE_SIDE);
        expect(heave[0].leagueFgPct).toBe(index.zones[heave[0].zone].fgPct);
    });
});

describe('the dashboard ships squares only', () => {
    test('no hexes ride along to the island', async () => {
        const shots = await fixtureShots();
        const hex = buildDashboard(shots.slice(0, 300), leagueContext(shots)).hex;
        expect(Object.keys(hex).sort()).toEqual(['side', 'squares', 'zones']);
        expect(hex.side).toBe(SQUARE_SIDE);
    });
});

describe('square sizing (the 2021 rule)', () => {
    test('single attempts are not drawn, and no square reaches its neighbour', async () => {
        const shots = await fixtureShots();
        const data = buildDashboard(shots.slice(0, 600), leagueContext(shots)).hex;
        const svg = document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement);
        renderHexShotChart(svg, data, { width: 500, mode: 'squares', animate: false });
        // cell squares: a translate()d path whose d is a square (M-a,-ah s v s h -s z); the legend's size keys sit one g deeper
        const sides = [...svg.querySelectorAll(':scope > g > g > path[transform]')]
            .map((p) => /^M(-?[\d.]+),/.exec(p.getAttribute('d') ?? ''))
            .filter((m): m is RegExpExecArray => m !== null)
            .map((m) => -2 * Number(m[1]));
        expect(sides).toHaveLength(data.squares.filter((c) => c.attempts >= MIN_DRAWN_ATTEMPTS).length);
        expect(data.squares.some((c) => c.attempts < MIN_DRAWN_ATTEMPTS)).toBe(true);
        const cell = toSvgLength(data.side, courtViewport(500));
        expect(Math.max(...sides)).toBeLessThanOrEqual(cell * SQUARE_FILL + 1e-9);
        expect(Math.max(...sides)).toBeLessThan(cell);
        svg.remove();
    });
});

describe('linked distance', () => {
    const hubDiv = () => { const d = document.createElement('div'); d.setAttribute('data-shot-link', ''); return d; };
    test('a chart hears the others in its dashboard, not itself and not another dashboard', () => {
        const hub = document.body.appendChild(hubDiv());
        const other = document.body.appendChild(hubDiv());
        const [a, b, c] = [hub, hub, other].map((p) => p.appendChild(document.createElement('svg')));
        const heard: (number | null)[] = [];
        const off = onDistance(b, ({ ft }) => heard.push(ft));
        onDistance(c, () => heard.push(-1));
        emitDistance(a, { ft: 12 });
        emitDistance(b, { ft: 99 }); // its own: ignored
        emitDistance(a, { ft: null });
        off();
        emitDistance(a, { ft: 3 });
        expect(heard).toEqual([12, null]);
        hub.remove();
        other.remove();
    });

    test('hovering a distance bar rings that distance on the court and dims the far squares', async () => {
        // jsdom has no layout: the tooltip measures its text
        (SVGElement.prototype as any).getBBox ??= () => ({ x: 0, y: 0, width: 40, height: 12 });
        const shots = await fixtureShots();
        const data = buildDashboard(shots.slice(0, 400), leagueContext(shots));
        const hub = document.body.appendChild(hubDiv());
        const svg = () => hub.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement);
        const court = svg();
        const bars = svg();
        const signature = svg();
        renderHexShotChart(court, data.hex, { width: 500, mode: 'squares', animate: false });
        renderDistanceBars(bars, data.bars, { metric: 'share', width: 500, animate: false });
        renderShootingSignature(signature, data.signature, { width: 500, animate: false });
        const ring = court.querySelector('circle')!;
        expect(ring.style.display).toBe('none');
        // the 24-26 ft bin's hover target: the second set of rects after the bars
        const targets = [...bars.querySelectorAll<SVGRectElement>('g > rect')].filter((r) => r.getAttribute('height') && r.style.fill === 'transparent');
        targets[8].dispatchEvent(new Event('pointerenter'));
        expect(ring.style.display).toBe('inline');
        expect(Number(ring.getAttribute('r'))).toBeGreaterThan(0);
        const opacities = [...court.querySelectorAll('g > path')].map((p) => (p as SVGPathElement).style.opacity).filter((o) => o !== '');
        expect(opacities).toContain('0.2');
        expect(signature.querySelector('g[pointer-events="none"]')!.getAttribute('style')).toContain('display: inline');
        targets[8].dispatchEvent(new Event('pointerleave'));
        expect(ring.style.display).toBe('none');
        hub.remove();
    });
});
