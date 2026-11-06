// astro/test/wnba/hexCourt.test.ts
// @vitest-environment jsdom
// The hex chart draws the court its data names (raw and zones modes); without one it draws the NBA's.
import { describe, expect, test } from 'vitest';
import { courtFor, type Court } from '../../src/basketball/config';
import { leagueContextFromRows, shotsFromRows } from '../../src/nba/adapters';
import { courtViewport } from '../../src/nba/charts/court';
import { renderHexShotChart } from '../../src/nba/charts/hexShotChart';
import { buildDashboard } from '../../src/nba/dashboard';
import { COURT, courtLines, zoneAreas } from '../../src/nba/data/court';
import { SEA, leagueContext, leagueShots2003, seaShots } from './dashboardFixtures';

const W = 500;
const drawn = (data: Parameters<typeof renderHexShotChart>[1], mode: 'raw' | 'zones') => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    document.body.appendChild(svg);
    renderHexShotChart(svg, data, { width: W, mode, animate: false });
    const out = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d'));
    svg.remove();
    return out;
};
const line = (court: Court, name: string) => courtLines(courtViewport(W), court).find((l) => l.name === name)!.d;

describe('the hex chart draws the season court', () => {
    const cases = [
        [2003, buildDashboard(shotsFromRows(leagueShots2003().filter((s) => s.team_id === SEA)), leagueContextFromRows(leagueContext(2003)), courtFor('wnba', 2003)).hex],
        [2026, buildDashboard(shotsFromRows(seaShots(2026)), leagueContextFromRows(leagueContext(2026)), courtFor('wnba', 2026)).hex],
    ] as const;
    for (const [season, data] of cases) test(String(season), () => {
        const court = courtFor('wnba', season);
        const raw = drawn(data, 'raw');
        expect(raw).toContain(line(court, 'three-point-line'));
        expect(raw).toContain(line(court, 'paint'));
        expect(raw).not.toContain(line(COURT, 'three-point-line'));
        const zones = drawn(data, 'zones');
        for (const a of zoneAreas(courtViewport(W), court)) expect(zones, a.zone).toContain(a.d);
    });
    test('no court in the data: the NBA court', () => {
        const { court: _drop, ...nbaShaped } = cases[1][1];
        expect(drawn(nbaShaped, 'raw')).toContain(line(COURT, 'three-point-line'));
    });
});
