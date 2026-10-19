// The college dashboards' config: the seasons stats.ncaa.org charted, the source switch, the scope wording, and an NCAA
// court that zones integer-tenth shots exactly as sdv-db's college SQL does (plan #7's court, Task 1 Step 0).
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor, islandLeagueProps, rankMins } from '../../src/basketball/config';
import { dashboardScope, isNcaaDashboards, NCAA_NO_POSTSEASON, shotsTable } from '../../src/basketball/dashboards';
import { mbbGamesInScope, mbbSeasonGames } from '../../src/nba/seasonRange';
import { zoneOf } from '../../src/nba/data/aggregate';
import { COURT, threeBreakY } from '../../src/nba/data/court';
import { resolveBasketballSeason } from '../../src/routes/basketball/season';

// sdv-db ncaa_shot_dashboards' men's court (plan #7, tenths of a foot), as Task 1 Step 0 printed it from the merged module
// (sdv-db origin/main 6c2d393): NEW_COURT = Court(60, 221.4583, 216.5625) from 2020 (D45 / R1 amended 2026-10-12: the rulebook's
// 21' 7 7/8" corner), OLD_COURT = Court(60, 207.5, 207.5); frame FREE_THROW_Y 137.5; restricted 40 from 2016
const SDV_DB = { oldArc: 207.5, oldCorner: 207.5, newArc: 221.4583, newCorner: 216.5625, newFrom: 2020, lane: 60, freeThrow: 137.5, restricted: 40 };
const sdvBreak = (s: number) =>
    s >= SDV_DB.newFrom ? Math.sqrt(SDV_DB.newArc ** 2 - SDV_DB.newCorner ** 2) : Math.sqrt(SDV_DB.oldArc ** 2 - SDV_DB.oldCorner ** 2);
const fakeAstro = (path: string) => ({ params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any }) as any;

describe('the NCAA court zones like the SQL, every dashboard season', () => {
    for (let s = 2019; s <= 2026; s++) test(String(s), () => {
        const c = courtFor('mbb', s);
        expect([c.laneHalfWidth, c.restrictedRadius, c.freeThrowY, c.halfWidth, c.baselineY]).toEqual([SDV_DB.lane, SDV_DB.restricted, SDV_DB.freeThrow, 250, -52.5]);
        expect(Math.floor(threeBreakY(c))).toBe(Math.floor(sdvBreak(s)));
        if (s >= SDV_DB.newFrom) {
            expect(c.threeCornerX).toBeCloseTo(SDV_DB.newCorner, 4); // D45 / R1: one corner constant
            expect(c.threeRadius).toBeCloseTo(SDV_DB.newArc, 4);     // one radius, 221.4583 in both repos
        }
    });
    test('the deciding rows: a corner three at y = 46 tenths, the first above-break row at 47 (2026); one arc to the end line in 2019', () => {
        const c = courtFor('mbb', 2026);
        expect(Math.floor(threeBreakY(c))).toBe(46);
        expect(zoneOf({ x_legacy: 217, y_legacy: 46, shot_value: 3 }, c)).toBe('corner_3_right');
        expect(zoneOf({ x_legacy: -217, y_legacy: 47, shot_value: 3 }, c)).toBe('above_break_3');
        expect(zoneOf({ x_legacy: 210, y_legacy: 1, shot_value: 3 }, courtFor('mbb', 2019))).toBe('above_break_3');
    });
    test("the 12 ft lane: a two 7 ft off the axis inside the free-throw line is mid-range on the NCAA court, paint on the NBA's", () => {
        const s = { x_legacy: 70, y_legacy: 60, shot_value: 2 };
        expect([zoneOf(s, courtFor('mbb', 2026)), zoneOf(s, COURT)]).toEqual(['mid_range', 'paint']);
    });
});

describe('the dashboard seasons and the source', () => {
    test('mbb lists 2019-2026 on the dashboards; an earlier ?season= is the current season', () => {
        const r = resolveBasketballSeason(fakeAstro('/mbb/teams?season=2018'), 'mbb');
        expect([r.seasons[0], r.seasons.at(-1), r.season, r.current, r.q]).toEqual([2019, 2026, 2026, 2026, '']);
        expect(resolveBasketballSeason(fakeAstro('/mbb/teams?season=2019'), 'mbb').season).toBe(2019);
    });
    test('the NBA and WNBA season lists did not change', () => {
        const nba = resolveBasketballSeason(fakeAstro('/nba/teams'), 'nba');
        expect([nba.seasons[0], nba.seasons.at(-1)]).toEqual([1998, 2026]);
        expect(resolveBasketballSeason(fakeAstro('/wnba/teams'), 'wnba').seasons[0]).toBe(1997);
    });
    test('the college source and its flags; the NBA and WNBA objects gained no key', () => {
        expect([isNcaaDashboards('mbb'), isNcaaDashboards('nba'), isNcaaDashboards('wnba')]).toEqual([true, false, false]);
        expect([shotsTable('mbb'), shotsTable('nba'), shotsTable('wnba')]).toEqual(['shot_rows', 'shots', 'shots']);
        const m = BASKETBALL.mbb;
        expect([m.shotFirstSeason, m.hidePie, m.leadersRead]).toEqual([2019, true, { days: 49, windows: [5, 10] }]);
        for (const lg of ['nba', 'wnba'] as const) {
            for (const k of ['shotFirstSeason', 'hidePie', 'leadersRead']) expect(Object.keys(BASKETBALL[lg]), `${lg} ${k}`).not.toContain(k);
        }
    });
});

describe('thresholds scale by games in scope (D44, R6)', () => {
    test('college bars read plan #8\'s gamesInScope (regular season + postseason), not regularSeasonGames', () => {
        expect([mbbGamesInScope(2026), mbbSeasonGames(2026), mbbGamesInScope(2021)]).toEqual([33, 32, 24]); // plan #8's measured tables
        expect(rankMins('mbb', 2026)).toEqual({ fga: Math.round((100 * 33) / 82), fg3a: Math.round((50 * 33) / 82) }); // 40 / 20
        expect(rankMins('mbb', 2021)).toEqual({ fga: 29, fg3a: 15 });
        expect(rankMins('mbb', 2019)).toEqual({ fga: Math.round((100 * 33) / 82), fg3a: Math.round((50 * 33) / 82) }); // 33 in 2018-19 too
        expect(islandLeagueProps('mbb', 2026)).toMatchObject({ highlight: null, minFga: 40 });
    });
    test('the NBA and WNBA bars did not move (no gamesInScope there)', () => {
        for (const lg of ['nba', 'wnba'] as const) {
            const cfg = BASKETBALL[lg];
            expect(Object.keys(cfg)).not.toContain('gamesInScope');
            const g = cfg.regularSeasonGames(2026);
            expect(rankMins(lg, 2026)).toEqual({ fga: Math.round((100 * g) / 82), fg3a: Math.round((50 * g) / 82) });
        }
    });
});

describe('the scope wording (D23)', () => {
    test("the NBA's and the WNBA's words are today's literals", () => {
        expect(dashboardScope('nba', 2026)).toEqual({ noun: 'regular season', adj: 'regular-season', source: 'stats.nba.com play-by-play', leagueLines: 'full regular season' });
        expect(dashboardScope('wnba', 2003).source).toBe('stats.wnba.com play-by-play');
    });
    test('college: regular season + postseason; 2020 had none', () => {
        expect(dashboardScope('mbb', 2026)).toEqual({
            noun: 'regular season + postseason', adj: 'regular-season and postseason', source: 'stats.ncaa.org shot charts', leagueLines: 'full regular season + postseason',
        });
        expect(NCAA_NO_POSTSEASON).toEqual([2020]);
        expect(dashboardScope('mbb', 2020)).toEqual({
            noun: 'regular season (no 2020 postseason: the tournaments were cancelled)', adj: 'regular-season', source: 'stats.ncaa.org shot charts', leagueLines: 'full regular season',
        });
    });
});
