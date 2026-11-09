// astro/test/mbb/parity.test.ts
// sdv-db's college league context must equal GOP's own TypeScript aggregation of the same shots on the season's NCAA court.
// (1) plan #7's committed fixture rows and the SQL's context over exactly them: every kind, zones included (plan #7 pinned
// the non-zone kinds against GOP and left the zones to this plan). (2) full Texas team-seasons from the Data API: the
// TypeScript rim and mid-range counts of the attributed shots equal the derived season rows' ra_* / mid_* sums.
import { describe, expect, test } from 'vitest';
import { courtFor } from '../../src/basketball/config';
import { leagueContextFromRows, shotsFromRows } from '../../src/nba/adapters';
import { BAR_BIN_FT, buildDashboard, HEX_RADIUS } from '../../src/nba/dashboard';
import { fgPctByDistance, leagueHexIndex, shootingLine, statsBySide, statsByZone, type LeagueHex } from '../../src/nba/data/aggregate';
import { COURT } from '../../src/nba/data/court';
import { TEX, fixtureLeagueContext, fixtureShotRows, leagueContext, seasonPlayers, texShots } from './dashboardFixtures';

const byCentre = (hexes: LeagueHex[]) => new Map(hexes.map((h) => [`${h.x},${h.y}`, [h.attempts, h.fgPct]]));
const fixture = (season: 2019 | 2026) => ({
    shots: shotsFromRows(fixtureShotRows().filter((r) => r.season === season)),
    sql: leagueContextFromRows(fixtureLeagueContext().filter((r) => r.season === season)),
    court: courtFor('mbb', season),
});

describe("plan #7's fixture rows: the SQL's context equals the TypeScript on the season's NCAA court", () => {
    for (const season of [2019, 2026] as const) {
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
    test("2026 on the NBA court zones differently (the 16 ft lane): the court is load-bearing", () => {
        const { shots, sql } = fixture(2026);
        expect(statsByZone(shots, COURT)).not.toEqual(sql.hexIndex.zones);
    });
    test("2019 on the 2026 NCAA court zones differently (the arc moved for 2019-20): the season's court is load-bearing", () => {
        const { shots, sql } = fixture(2019);
        expect(courtFor('mbb', 2026)).not.toBe(courtFor('mbb', 2019));
        expect(statsByZone(shots, courtFor('mbb', 2026))).not.toEqual(sql.hexIndex.zones);
    });
});

describe('Texas team-seasons: the TypeScript zones of the attributed shots equal the derived rim and mid-range counts', () => {
    for (const season of [2019, 2026] as const) test(String(season), () => {
        const rows = seasonPlayers(season).filter((r) => r.team_id === TEX);
        const sum = (k: 'attempts' | 'ra_attempts' | 'ra_makes' | 'mid_attempts' | 'mid_makes') => rows.reduce((a, r) => a + r[k], 0);
        const shots = shotsFromRows(texShots(season).filter((s) => s.person_id !== null));
        const z = statsByZone(shots, courtFor('mbb', season));
        expect(shots.length).toBe(sum('attempts'));
        expect([z.restricted_area.attempts, z.restricted_area.makes, z.mid_range.attempts, z.mid_range.makes])
            .toEqual([sum('ra_attempts'), sum('ra_makes'), sum('mid_attempts'), sum('mid_makes')]);
    });
    test('the league-wide 2026 context: every placed shot has one zone', () => {
        const ctx = leagueContextFromRows(leagueContext(2026));
        const zoned = Object.values(ctx.hexIndex.zones).reduce((a, z) => a + z.attempts, 0);
        expect(zoned).toBe(leagueContext(2026).find((r) => r.kind === 'total')!.attempts);
    });
    test('buildDashboard carries the NCAA court (it is not the NBA court)', () => {
        const d = buildDashboard(shotsFromRows(texShots(2026)), leagueContextFromRows(leagueContext(2026)), courtFor('mbb', 2026));
        expect(d.hex.court).toBe(courtFor('mbb', 2026));
    });
});
