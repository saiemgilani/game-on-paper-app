// astro/test/wnba/courts.test.ts
// The WNBA court by season (plan #3 Task 5's eras, sourced; plan #5 Task 1 built them): 12 ft lane and a 19'9" arc through
// 2003, 16 ft lane and 20'6.25" through 2012, 22'1.75" with 22 ft corners from 2013; no restricted arc before the adoption
// season plan #3 records (D32, R5). Courts are named by season, never by constant.
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor } from '../../src/basketball/config';
import { COURT, WNBA_RESTRICTED_AREA, courtLines, threeBreakY, toSvg, viewport, zoneAreas } from '../../src/nba/data/court';
import { fromProcessor } from '../../src/resources/nbaGame';
import NbaGameShotCharts from '../../src/components/nba/game/NbaGameShotCharts.astro';

// sdv-db nba_shot_dashboards.WNBA_COURTS (plan #3 Task 5) in GOP's keys, tenths of a foot: plan #5 Task 1 Step 0's capture,
// re-checked against sdv-db by this task's Step 0
type Era = { from: number; laneHalfWidth: number; threeRadius: number; threeCornerX: number; restrictedRadius: number };
const SDV_DB: Era[] = JSON.parse(readFileSync(new URL('../fixtures/wnba/sdv_db_wnba_courts.json', import.meta.url)).toString()).courts;
const MARKINGS = ['laneHalfWidth', 'threeRadius', 'threeCornerX', 'restrictedRadius'];
const SIX = ['restricted_area', 'paint', 'mid_range', 'corner_3_left', 'corner_3_right', 'above_break_3'];
const v = viewport(500, 350, 25);
const pix = (y: number) => (v.top - y) * v.scale; // a legacy y as toSvg's y

describe('WNBA courts by season', () => {
    test("sdv-db's eras and figures in GOP's keys, restricted radius included; every other key is the NBA's", () => {
        const eras = BASKETBALL.wnba.courts;
        expect(eras.map((e) => e.from)).toEqual(SDV_DB.map((r) => r.from));
        eras.forEach((e, i) => {
            const r = SDV_DB[i];
            expect(e.court.laneHalfWidth, String(e.from)).toBe(r.laneHalfWidth);
            expect(e.court.threeRadius, String(e.from)).toBeCloseTo(r.threeRadius, 9);
            expect(e.court.threeCornerX, String(e.from)).toBeCloseTo(r.threeCornerX, 9);
            expect(e.court.restrictedRadius, String(e.from)).toBe(r.restrictedRadius);
            for (const k of Object.keys(COURT).filter((k) => !MARKINGS.includes(k))) {
                expect((e.court as Record<string, number>)[k], `${e.from} ${k}`).toBe((COURT as Record<string, number>)[k]);
            }
        });
    });
    test('line boundaries; the restricted arc only from adoption (R5: asserts 0 before it); the NBA keeps its one court', () => {
        const at = (s: number) => courtFor('wnba', s);
        expect([1997, 2003].map((s) => at(s).laneHalfWidth)).toEqual([60, 60]);
        expect([2004, 2012, 2013, 2026].map((s) => at(s).laneHalfWidth)).toEqual([80, 80, 80, 80]);
        expect(at(2012).threeRadius).toBeCloseTo((20 * 12 + 6.25) / 1.2, 9);
        expect(at(2013).threeRadius).toBeCloseTo((22 * 12 + 1.75) / 1.2, 9);
        for (let s = 1997; s < WNBA_RESTRICTED_AREA.from; s++) expect(at(s).restrictedRadius, String(s)).toBe(0);
        for (let s = WNBA_RESTRICTED_AREA.from; s <= 2026; s++) expect(at(s).restrictedRadius, String(s)).toBe(WNBA_RESTRICTED_AREA.radius);
        for (const s of [1998, 2003, 2026]) expect(courtFor('nba', s)).toBe(COURT);
    });
    test('before 2013 the line is one arc down to the rim line: the corner break is at 0', () => {
        expect(threeBreakY(courtFor('wnba', 2003))).toBe(0);
        expect(threeBreakY(courtFor('wnba', 2008))).toBe(0);
        expect(threeBreakY(courtFor('wnba', 2026))).toBeCloseTo(25.373, 3);
    });
    test('every era draws finite lines and its zones (no restricted arc or zone at radius 0), each corner label inside its strip', () => {
        for (const { from, court } of BASKETBALL.wnba.courts) {
            const arc = court.restrictedRadius > 0;
            const lines = courtLines(v, court);
            for (const l of lines) expect(l.d, `${from} ${l.name}`).not.toMatch(/NaN|Infinity/);
            expect(lines.some((l) => l.name === 'restricted-area'), String(from)).toBe(arc);
            const areas = zoneAreas(v, court);
            expect(areas.map((a) => a.zone), String(from)).toEqual(arc ? SIX : SIX.slice(1));
            for (const a of areas) expect(a.d, `${from} ${a.zone}`).not.toMatch(/NaN|Infinity/);
            for (const corner of areas.filter((a) => a.zone.startsWith('corner_3'))) {
                expect(corner.label.y, `${from} ${corner.zone}`).toBeGreaterThanOrEqual(pix(threeBreakY(court)));
                expect(corner.label.y, `${from} ${corner.zone}`).toBeLessThanOrEqual(pix(court.baselineY));
            }
        }
    });
    test("the NBA's six zone areas are the ones plan #4 drew", () => {
        expect(zoneAreas(v, COURT).map((a) => a.zone)).toEqual(SIX);
        expect(zoneAreas(v, COURT)).toEqual(zoneAreas(v));
    });
    test("the NBA's corner labels did not move", () => {
        const cx = (COURT.halfWidth + COURT.threeCornerX) / 2;
        expect(zoneAreas(v, COURT)[3].label).toEqual(toSvg({ x: -cx, y: 20 }, v));
        expect(zoneAreas(v, COURT)[4].label).toEqual(toSvg({ x: cx, y: 20 }, v));
    });
    test("a 2005 game page's shot chart gets the 2004-2012 court (plan #4's courtFor on the game's season)", async () => {
        const game = fromProcessor(JSON.parse(readFileSync(new URL('../fixtures/wnba/game_250603003_processor.json', import.meta.url), 'utf8')), 'wnba');
        expect(game.season).toBe(2005);
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const html = await container.renderToString(NbaGameShotCharts, { props: { game }, locals: { league: 'wnba', preview: true } as App.Locals });
        // the island's serialized props carry the court only when it is not the NBA's; 205.2083… is 20'6.25" in tenths
        expect(html).toContain(String((20 * 12 + 6.25) / 1.2));
        expect(html).not.toContain(String((22 * 12 + 1.75) / 1.2));
    });
});
