// astro/test/basketball/placeholder.test.ts
// D29 / R4: the one placeholder rule and the one note sentence; the NBA (no placeholderLocation) keeps every shot, 1998-2010
// hoop-centre ones included, so its dashboards do not move.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor } from '../../src/basketball/config';
import { leagueContextFromRows, shotsFromRows } from '../../src/nba/adapters';
import { buildDashboard } from '../../src/nba/dashboard';
import { statsByZone } from '../../src/nba/data/aggregate';
import { placeholderAt, placeholderNote, placeholderSplit } from '../../src/nba/data/placeholder';

const njn = shotsFromRows(JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/nba/shots_2003_njn.json.gz', import.meta.url))).toString()));
// the NBA league context exactly as plan #4's byte-identity test builds it from the real fixture (its season does not matter
// here: it only feeds the "vs league" half of both dashboards being compared)
const oracle = JSON.parse(readFileSync(new URL('../fixtures/nba/league_context.json', import.meta.url)).toString());
const ctx = leagueContextFromRows([
    ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
    { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
] as any);

describe('placeholders', () => {
    test('the NBA has no placeholder location: real 2003 hoop-centre shots stay, same array, same dashboard', () => {
        expect(BASKETBALL.nba.placeholderLocation).toBeUndefined();
        expect(njn.filter((s) => s.x_legacy === 0 && s.y_legacy === 0)).toHaveLength(2078);
        const split = placeholderSplit(njn, BASKETBALL.nba.placeholderLocation);
        expect(split.located).toBe(njn);
        expect(split.unlocated).toBe(0);
        expect(buildDashboard(njn, ctx, courtFor('nba', 2003), BASKETBALL.nba.placeholderLocation)).toEqual(buildDashboard(njn, ctx));
        expect(statsByZone(njn).restricted_area.attempts).toBeGreaterThanOrEqual(2078); // still rim attempts, as today
    });
    test('a location drops exactly the shots at it', () => {
        const { located, unlocated } = placeholderSplit(njn, { x: 0, y: 0, through: 2010 });
        expect([located.length, unlocated]).toEqual([6585 - 2078, 2078]);
        expect(located.some((s) => s.x_legacy === 0 && s.y_legacy === 0)).toBe(false);
    });
    test('placeholderAt: the location up to and including `through`, nothing after it or without one (R22)', () => {
        const loc = { x: 0, y: 0, through: 2010 };
        expect([placeholderAt(loc, 1997), placeholderAt(loc, 2010), placeholderAt(loc, 2011), placeholderAt(undefined, 2003)]).toEqual([loc, loc, null, null]);
    });
    test('the note: one sentence, two scopes, nothing when every shot is located', () => {
        expect(placeholderNote(5677, 28436, 'season')).toBe('5,677 of 28,436 shots this season have no recorded location.');
        expect(placeholderNote(3, 64, 'game')).toBe('3 of 64 shots have no recorded location.');
        expect(placeholderNote(0, 3061, 'season')).toBe('');
    });
});
