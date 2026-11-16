// @vitest-environment jsdom
// BB-G10: a lower-is-better axis (defensive rating) runs the other way, so the better defense sits higher; a shooting axis does not.
import { zoomIdentity } from 'd3-zoom';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { renderScatter } from '../../src/nba/charts/scatterChart';
import { AXIS_METRICS, type AxisMetric, type ScatterPoint } from '../../src/nba/scatterMetrics';

beforeAll(() => { vi.stubGlobal('fetch', () => { throw new Error('unmocked network read'); }); });
afterAll(() => { vi.unstubAllGlobals(); });

const point = (id: number, values: Partial<Record<AxisMetric, number>>): ScatterPoint => ({
    person_id: id, name: `T${id}`, team_id: id, team: `T${id}`, color: '#123456', nets: false, headshot: null,
    v: AXIS_METRICS.map((m) => values[m] ?? null),
});
const cy = (x: AxisMetric, y: AxisMetric, points: ScatterPoint[]) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svg);
    renderScatter(svg, points, { width: 600, x, y, faces: false, filter: '', transform: zoomIdentity, onZoom: () => {}, canvas: null });
    return [...svg.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cy')));
};

test('Def rating (reversed): the 108 defense is drawn above the 118 one; eFG% keeps the higher value above', () => {
    const [good, bad] = cy('offRtg', 'defRtg', [point(1, { offRtg: 115, defRtg: 108 }), point(2, { offRtg: 112, defRtg: 118 })]);
    expect(good).toBeLessThan(bad); // svg y grows downward
    const [high, low] = cy('ptsPg', 'efgPct', [point(1, { ptsPg: 20, efgPct: 0.6 }), point(2, { ptsPg: 10, efgPct: 0.5 })]);
    expect(high).toBeLessThan(low);
});
