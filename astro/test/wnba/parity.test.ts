// astro/test/wnba/parity.test.ts
// sdv-db's derived tables must equal GOP's own TypeScript aggregation of the raw shots, on the season's court. There is no
// WNBA blazing-the-nets site to compare against: GOP's aggregate.ts is the oracle (the NBA's tables were checked against
// blazing's; the code is the same, so this is the same check with the court the WNBA played on).
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor } from '../../src/basketball/config';
import { leagueContextFromRows, shotsFromRows } from '../../src/nba/adapters';
import { BAR_BIN_FT, buildDashboard, HEX_RADIUS } from '../../src/nba/dashboard';
import { fgPctByDistance, leagueHexIndex, shootingLine, statsBySide, statsByZone, type LeagueHex } from '../../src/nba/data/aggregate';
import { COURT, WNBA_RESTRICTED_AREA } from '../../src/nba/data/court';
import { readFileSync } from 'node:fs';
import { placeholderAt, placeholderSplit } from '../../src/nba/data/placeholder';
import { SEA, leagueContext, leagueOrigin2026, leagueShots2003, seaShots, seasonPlayers } from './dashboardFixtures';

const byCentre = (hexes: LeagueHex[]) => new Map(hexes.map((h) => [`${h.x},${h.y}`, [h.attempts, h.fgPct]]));
const PH = BASKETBALL.wnba.placeholderLocation; // D29 / R4 / R22: plan #3's hoop-centre point and last placeholder season
const CONTRACT = JSON.parse(readFileSync(new URL('../fixtures/wnba/sdv_db_wnba_courts.json', import.meta.url)).toString());
const all = shotsFromRows(leagueShots2003());
const { located, unlocated } = placeholderSplit(all, placeholderAt(PH, 2003));
const sql = leagueContextFromRows(leagueContext(2003));
const court2003 = courtFor('wnba', 2003);

describe('2003, league-wide: shot_league_context equals the TypeScript aggregate of the LOCATED regular-season shots (D29)', () => {
    test('the placeholder: 5,677 shots excluded, counted in the total, no hex at the hoop centre', () => {
        expect(PH).toEqual(CONTRACT.placeholder); // R22: GOP and sdv-db agree on the point and the last season
        expect(PH).toMatchObject({ x: 0, y: 0 });
        expect(PH!.through).toBeGreaterThanOrEqual(2008); // 2003 and 2008 are placeholder seasons in every case below
        expect([unlocated, located.length]).toEqual([5677, 28436 - 5677]);
        expect(leagueContext(2003).find((r) => r.kind === 'total')!.placeholder_shots).toBe(unlocated);
        expect(sql.hexIndex.hexes.some((h) => h.x === 0 && h.y === 0 && h.attempts >= 5677)).toBe(false);
    });
    test('hexes: the same centres, attempts and FG%', () => {
        expect(byCentre(sql.hexIndex.hexes)).toEqual(byCentre(leagueHexIndex(located, HEX_RADIUS, court2003).hexes));
    });
    test("zones on 2003's court (12 ft lane, 19'9\" arc down to the rim line), and NOT on the NBA's", () => {
        expect(sql.hexIndex.zones).toEqual(statsByZone(located, court2003));
        expect(sql.hexIndex.zones).not.toEqual(statsByZone(located, COURT));
        expect(sql.hexIndex.zones).not.toEqual(statsByZone(all, court2003)); // the placeholders would all be rim attempts
        expect(statsByZone(located)).toEqual(statsByZone(located, COURT)); // the default is the NBA court
    });
    test('distance and side lines exclude the placeholders; the total line counts them', () => {
        expect(sql.byFoot).toEqual(fgPctByDistance(located));
        expect(sql.byBin).toEqual(fgPctByDistance(located, BAR_BIN_FT));
        expect(sql.sides).toEqual(statsBySide(located, BAR_BIN_FT));
        expect(sql.fgPct).toBe(shootingLine(all).fgPct);
    });
});

describe('Seattle by era, one season before and one after the restricted-arc adoption (D32): the TypeScript zones equal the derived counts', () => {
    const cases = [
        [2003, shotsFromRows(leagueShots2003().filter((s) => s.team_id === SEA))],
        [2008, shotsFromRows(seaShots(2008))],
        [2026, shotsFromRows(seaShots(2026))],
    ] as const;
    test('the cases span the adoption season plan #3 records', () => {
        const radii = cases.map(([s]) => courtFor('wnba', s).restrictedRadius);
        expect(radii.some((r) => r === 0), `adoption ${WNBA_RESTRICTED_AREA.from}`).toBe(true);
        expect(radii.some((r) => r > 0)).toBe(true);
    });
    for (const [season, shots] of cases) test(String(season), () => {
        const rows = seasonPlayers(season).filter((r) => r.team_id === SEA);
        const sum = (k: 'attempts' | 'ra_attempts' | 'ra_makes' | 'mid_attempts' | 'mid_makes') => rows.reduce((a, r) => a + r[k], 0);
        const z = statsByZone(placeholderSplit(shots, placeholderAt(PH, season)).located, courtFor('wnba', season));
        expect(shots.length).toBe(sum('attempts')); // totals count the placeholders
        expect([z.restricted_area.attempts, z.restricted_area.makes, z.mid_range.attempts, z.mid_range.makes])
            .toEqual([sum('ra_attempts'), sum('ra_makes'), sum('mid_attempts'), sum('mid_makes')]);
        if (courtFor('wnba', season).restrictedRadius === 0) expect(z.restricted_area.attempts, String(season)).toBe(0);
    });
    test('2003: the 12 ft lane moves lane-band twos from the paint to mid-range', () => {
        const shots = placeholderSplit(shotsFromRows(leagueShots2003().filter((s) => s.team_id === SEA)), placeholderAt(PH, 2003)).located;
        expect(statsByZone(shots, court2003).mid_range.attempts).toBeGreaterThan(statsByZone(shots, COURT).mid_range.attempts);
    });
});

describe('buildDashboard carries a non-NBA court and the placeholder count, the NBA neither', () => {
    test('the hex data and the unlocated count', () => {
        const d = buildDashboard(all, sql, court2003, placeholderAt(PH, 2003));
        expect(d.hex.court).toBe(court2003);
        expect(d.hex.zones.mid_range).toEqual({ player: statsByZone(located, court2003).mid_range, league: sql.hexIndex.zones.mid_range });
        expect(d.unlocated).toEqual({ count: 5677, total: 28436 });
        expect('court' in buildDashboard(all, sql).hex).toBe(false);
        expect('court' in buildDashboard(all, sql, COURT).hex).toBe(false);
        expect('unlocated' in buildDashboard(all, sql)).toBe(false);
        expect('unlocated' in buildDashboard(shotsFromRows(seaShots(2026)), sql, courtFor('wnba', 2026), placeholderAt(PH, 2026))).toBe(false); // none in 2026's Seattle shots
    });
});

describe('R22: after the last placeholder season a (0, 0) shot is a real shot', () => {
    test("2026's genuine hoop-centre shots (real rows) are drawn and counted as located", () => {
        const origin = shotsFromRows(leagueOrigin2026());
        expect(origin.length).toBeGreaterThan(0); // 4 on the 2026-10-12 release
        expect(origin.every((s) => s.x_legacy === 0 && s.y_legacy === 0)).toBe(true);
        expect(placeholderAt(PH, 2026)).toBeNull(); // 2026 > through
        const { located: kept, unlocated: none } = placeholderSplit(origin, placeholderAt(PH, 2026));
        expect([kept.length, none]).toEqual([origin.length, 0]);
        const d = buildDashboard(origin, leagueContextFromRows(leagueContext(2026)), courtFor('wnba', 2026), placeholderAt(PH, 2026));
        expect('unlocated' in d).toBe(false);
        expect(d.hex.zones.restricted_area.player.attempts).toBe(origin.length); // drawn at the rim (2026 has the 4 ft arc)
        // sdv-db agrees: R22 bounds plan #3's predicate the same way, so the 2026 league total counts no placeholder
        expect(leagueContext(2026).find((r) => r.kind === 'total')!.placeholder_shots ?? 0).toBe(0);
    });
    test('the same shots in a placeholder season would be excluded: the bound is the only difference', () => {
        expect(placeholderSplit(shotsFromRows(leagueOrigin2026()), placeholderAt(PH, PH!.through)).located).toHaveLength(0);
    });
});
