// astro/test/wbb/dashboardConfig.test.ts
// The women's college dashboards' config: the seasons stats.ncaa.org charted, the source, the scope wording, plan #9's three
// fields with WBB's measured values, and a women's court that zones integer-tenth shots exactly as sdv-db's SQL (Step 0).
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor, rankMins } from '../../src/basketball/config';
import { dashboardScope, isNcaaDashboards, shotsTable } from '../../src/basketball/dashboards';
import { zoneOf } from '../../src/nba/data/aggregate';
import { COURT, threeBreakY } from '../../src/nba/data/court';
import { wbbGamesInScope } from '../../src/nba/seasonRange';
import { resolveBasketballSeason } from '../../src/routes/basketball/season';

// sdv-db ncaa_shot_dashboards' women's court (plan #7, tenths of a foot), as Task 1 Step 0 printed it from the merged module
const SDV_DB = {
    oldArc: 207.5, oldCorner: 207.5, newArc: 221.4583, newCorner: 216.5625, newFrom: 2022, lane: 60, freeThrow: 137.5,
    // R5: plan #7's NCAA_RESTRICTED['wbb'] — 4 ft from 2017-18, none from 2023-24
    restricted: { 2019: 40, 2020: 40, 2021: 40, 2022: 40, 2023: 40, 2024: 0, 2025: 0, 2026: 0 } as Record<number, number>,
};
const sdvBreak = (s: number) =>
    s >= SDV_DB.newFrom ? Math.sqrt(SDV_DB.newArc ** 2 - SDV_DB.newCorner ** 2) : Math.sqrt(SDV_DB.oldArc ** 2 - SDV_DB.oldCorner ** 2);
const fakeAstro = (path: string) => ({ params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any }) as any;

describe("the women's NCAA court zones like the SQL, every dashboard season", () => {
    for (let s = 2019; s <= 2026; s++) test(String(s), () => {
        const c = courtFor('wbb', s);
        expect([c.laneHalfWidth, c.restrictedRadius, c.freeThrowY, c.halfWidth, c.baselineY]).toEqual([SDV_DB.lane, SDV_DB.restricted[s], SDV_DB.freeThrow, 250, -52.5]);
        expect(Math.floor(threeBreakY(c))).toBe(Math.floor(sdvBreak(s)));
        if (s >= SDV_DB.newFrom) expect([c.threeCornerX, c.threeRadius].map((v) => +v.toFixed(4))).toEqual([SDV_DB.newCorner, SDV_DB.newArc]); // D45 / R1
    });
    test('the arc moved in 2021-22 for the women (2019-20 for the men): a corner-band three at y = 45 tenths', () => {
        const three = { x_legacy: 217, y_legacy: 45, shot_value: 3 };
        expect([zoneOf(three, courtFor('wbb', 2021)), zoneOf(three, courtFor('wbb', 2022))]).toEqual(['above_break_3', 'corner_3_right']);
        expect(zoneOf({ x_legacy: -217, y_legacy: 47, shot_value: 3 }, courtFor('wbb', 2026))).toBe('above_break_3'); // break 46.31: y = 46 is still the corner
        expect(courtFor('wbb', 2021).threeRadius).not.toBe(courtFor('mbb', 2021).threeRadius);
        expect(courtFor('wbb', 2022).threeRadius).toBe(courtFor('mbb', 2022).threeRadius);
    });
    test("the 12 ft lane: a two 7 ft off the axis inside the free-throw line is mid-range on the women's court, paint on the NBA's", () => {
        const s = { x_legacy: 70, y_legacy: 60, shot_value: 2 };
        expect([zoneOf(s, courtFor('wbb', 2026)), zoneOf(s, COURT)]).toEqual(['mid_range', 'paint']);
    });
});

describe('the dashboard seasons, the source and the three college fields', () => {
    test('wbb lists 2019-2026 on the dashboards; an earlier ?season= is the current season', () => {
        const r = resolveBasketballSeason(fakeAstro('/wbb/teams?season=2018'), 'wbb');
        expect([r.seasons[0], r.seasons.at(-1), r.season, r.current, r.q]).toEqual([2019, 2026, 2026, 2026, '']);
        expect(resolveBasketballSeason(fakeAstro('/wbb/teams?season=2019'), 'wbb').season).toBe(2019);
    });
    test('the college source, and the values measured on WBB (plan #11 Measured facts)', () => {
        expect([isNcaaDashboards('wbb'), shotsTable('wbb')]).toEqual([true, 'shot_rows']);
        const w = BASKETBALL.wbb;
        expect([w.shotFirstSeason, w.hidePie, w.leadersRead]).toEqual([2019, true, { days: 49, windows: [5, 10] }]);
        expect(w.leadersRead).toEqual(BASKETBALL.mbb.leadersRead); // one rule for college, measured on both leagues
    });
    test('D44 (R6): thresholds scale by plan #10\'s games in scope (regular + postseason); this plan pins them', () => {
        expect([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map(wbbGamesInScope)).toEqual([31, 30, 23, 30, 31, 32, 30, 32]);
        expect(BASKETBALL.wbb.gamesInScope).toBe(wbbGamesInScope);
        expect([rankMins('wbb', 2026), rankMins('wbb', 2021)]).toEqual([{ fga: 39, fg3a: 20 }, { fga: 28, fg3a: 14 }]);
        expect(Object.keys(BASKETBALL.wbb)).not.toContain('scatterConference'); // D46: the default is computed (Task 7), never configured
    });
    test('the scope wording is the college one; 2019-20 had no postseason for the women either', () => {
        expect(dashboardScope('wbb', 2026)).toEqual(dashboardScope('mbb', 2026));
        expect(dashboardScope('wbb', 2020).noun).toBe('regular season (no 2020 postseason: the tournaments were cancelled)');
        expect(dashboardScope('wbb', 2026).source).toBe('stats.ncaa.org shot charts');
    });
});
