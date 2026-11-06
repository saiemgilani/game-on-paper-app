// astro/test/wbb/parity.test.ts
// sdv-db's women's league context must equal GOP's own TypeScript aggregation of the same shots on the season's women's court.
// (1) plan #7's committed South Carolina rows either side of the 2021-22 arc move, and the SQL's context over exactly them:
// every kind, zones included. (2) full South Carolina team-seasons from the Data API: the TypeScript rim and mid-range counts
// of the attributed shots equal the derived season rows' ra_* / mid_* sums.
import { describe, expect, test } from 'vitest';
import { courtFor } from '../../src/basketball/config';
import { leagueContextFromRows, shotsFromRows } from '../../src/nba/adapters';
import { BAR_BIN_FT, buildDashboard, HEX_RADIUS } from '../../src/nba/dashboard';
import { fgPctByDistance, leagueHexIndex, shootingLine, statsBySide, statsByZone, type LeagueHex } from '../../src/nba/data/aggregate';
import { COURT } from '../../src/nba/data/court';
import { SC, fixtureLeagueContext, fixtureShotRows, leagueContext, scShots, seasonPlayers, type Season } from './dashboardFixtures';

const byCentre = (hexes: LeagueHex[]) => new Map(hexes.map((h) => [`${h.x},${h.y}`, [h.attempts, h.fgPct]]));
const fixture = (season: 2021 | 2022) => ({
    shots: shotsFromRows(fixtureShotRows().filter((r) => r.season === season)),
    sql: leagueContextFromRows(fixtureLeagueContext().filter((r) => r.season === season)),
    court: courtFor('wbb', season),
});

describe("plan #7's South Carolina rows: the SQL's context equals the TypeScript on the season's women's court", () => {
    for (const season of [2021, 2022] as const) {
        test(`${season}: hexes`, () => {
            const { shots, sql, court } = fixture(season);
            expect(byCentre(sql.hexIndex.hexes)).toEqual(byCentre(leagueHexIndex(shots, HEX_RADIUS, court).hexes));
        });
        test(`${season}: zones`, () => {
            const { shots, sql, court } = fixture(season);
            expect(sql.hexIndex.zones).toEqual(statsByZone(shots, court));
        });
        test(`${season}: distance, side and total lines`, () => {
            const { shots, sql } = fixture(season);
            expect(sql.byFoot).toEqual(fgPctByDistance(shots));
            expect(sql.byBin).toEqual(fgPctByDistance(shots, BAR_BIN_FT));
            expect(sql.sides).toEqual(statsBySide(shots, BAR_BIN_FT));
            expect(sql.fgPct).toBe(shootingLine(shots).fgPct);
        });
    }
    test('the court is load-bearing: the other season\'s women\'s court, the men\'s 2021 court and the NBA court all zone differently', () => {
        const a = fixture(2021);
        const b = fixture(2022);
        expect(statsByZone(a.shots, courtFor('wbb', 2022))).not.toEqual(a.sql.hexIndex.zones); // corner-band threes become corner threes
        expect(statsByZone(b.shots, courtFor('wbb', 2021))).not.toEqual(b.sql.hexIndex.zones); // and back
        expect(statsByZone(a.shots, courtFor('mbb', 2021))).not.toEqual(a.sql.hexIndex.zones); // the men moved in 2019-20
        expect(statsByZone(b.shots, COURT)).not.toEqual(b.sql.hexIndex.zones);                  // the 16 ft lane
    });
});

describe('South Carolina team-seasons: the TypeScript zones of the attributed shots equal the derived rim and mid-range counts', () => {
    for (const season of [2019, 2022, 2026] as const) test(String(season), () => {
        const rows = seasonPlayers(season).filter((r) => r.team_id === SC);
        const sum = (k: 'attempts' | 'ra_attempts' | 'ra_makes' | 'mid_attempts' | 'mid_makes') => rows.reduce((a, r) => a + r[k], 0);
        const shots = shotsFromRows(scShots(season).filter((s) => s.person_id !== null));
        const z = statsByZone(shots, courtFor('wbb', season));
        expect(shots.length).toBe(sum('attempts'));
        expect([z.restricted_area.attempts, z.restricted_area.makes, z.mid_range.attempts, z.mid_range.makes])
            .toEqual([sum('ra_attempts'), sum('ra_makes'), sum('mid_attempts'), sum('mid_makes')]);
    });
    test('the league-wide contexts: every placed shot has exactly one zone', () => {
        for (const s of [2019, 2022, 2026] as Season[]) {
            const ctx = leagueContextFromRows(leagueContext(s));
            const zoned = Object.values(ctx.hexIndex.zones).reduce((a, z) => a + z.attempts, 0);
            expect(zoned, String(s)).toBe(leagueContext(s).find((r) => r.kind === 'total')!.attempts);
        }
    });
    test("buildDashboard carries the women's court", () => {
        const d = buildDashboard(shotsFromRows(scShots(2026)), leagueContextFromRows(leagueContext(2026)), courtFor('wbb', 2026));
        expect(d.hex.court).toBe(courtFor('wbb', 2026));
    });
});
