// astro/test/basketball/regulation.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { fromDataApi, fromProcessor, requiredPeriods, scheduleRegulation } from '../../src/resources/nbaGame';
import { sanityGate } from '../../src/routes/nba/game';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());

describe('regulation comes from the data (Review Focus 4)', () => {
    test("the Data API path reads schedule.format_regulation_periods (4.0, a float, in the real row)", () => {
        const api = read('game_401766458_api');
        expect(api.schedule[0].format_regulation_periods).toBe(4);
        expect(scheduleRegulation(api.schedule[0], 'nba')).toEqual({ periods: 4, kind: 'quarter', periodMinutes: 12 });
        const g = fromDataApi(api, 'nba');
        expect([g.season, g.regulation, g.periodKind, g.periods, g.hasOvertime]).toEqual([2025, 4, 'quarter', 4, false]);
        expect(sanityGate(api)).toBeNull();
    });
    test('the processor path: regulation_periods when present, the season rule when absent (the pre-PR fixture)', () => {
        const proc = read('game_401766458_processor');
        expect(proc.regulation_periods).toBeUndefined();
        const a = fromProcessor(proc, 'nba');
        const b = fromProcessor({ ...proc, regulation_periods: 4 }, 'nba');
        expect([a.season, a.regulation, a.periodKind, a.hasOvertime]).toEqual([2025, 4, 'quarter', false]);
        expect(b).toEqual(a);
        expect(fromProcessor(proc)).toEqual(a); // the one-argument NBA call
    });
    test('an overtime processor game is overtime against its regulation', () => {
        const j = read('game_401766458_processor');
        j.periods = 5;
        expect(fromProcessor(j, 'nba').hasOvertime).toBe(true);
    });
});

describe('the sanity gate asks for the regulation, never a literal 4 (Review Focus 3)', () => {
    test('quarters: the real NBA row', () => {
        expect(requiredPeriods(read('game_401766458_api').schedule[0], 4)).toBe(4);
    });
    test('halves (spec §3.1 literal rows: an MBB final, an MBB overtime final, a row without status_period)', () => {
        expect(requiredPeriods({ status_period: 2 }, 2)).toBe(2);
        expect(requiredPeriods({ status_period: 3 }, 2)).toBe(3);
        expect(requiredPeriods({ status_period: null }, 2)).toBe(2);
        expect(requiredPeriods({}, 2)).toBe(2);
    });
});
