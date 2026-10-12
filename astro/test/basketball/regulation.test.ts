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

describe('the data value wins over the season fallback (mutations of the real fixtures)', () => {
    // mutation: no real NBA game has halves; proves the data value wins over the season fallback
    test('processor: regulation_periods 2 gives halves; its real 4 periods are then overtime', () => {
        const proc = read('game_401766458_processor');
        const g = fromProcessor({ ...proc, regulation_periods: 2 }, 'nba');
        expect([g.regulation, g.periodKind, g.periods, g.hasOvertime]).toEqual([2, 'half', proc.periods, proc.periods > 2]);
    });
    // mutation: no real NBA game has halves; proves the data value wins over the season fallback
    test('Data API: format_regulation_periods 2.0 gives halves', () => {
        const api = read('game_401766458_api');
        expect(scheduleRegulation({ ...api.schedule[0], format_regulation_periods: 2.0 }, 'nba').periods).toBe(2);
    });
    // mutation: no real NBA game has halves; proves the data value wins over the season fallback
    test('sanity gate: a two-period final passes at regulation 2 and fails at regulation 4', () => {
        const api = read('game_401766458_api');
        const pbp = api.pbp.filter((r: any) => Number(r.period_number) <= 2);
        const ns = new Set(pbp.map((r: any) => r.game_play_number));
        const last = [...pbp].sort((a: any, b: any) => a.game_play_number - b.game_play_number).at(-1);
        const rows = (regulation: number) => ({
            ...api, pbp, play_wp: api.play_wp.filter((w: any) => ns.has(w.game_play_number)),
            schedule: [{ ...api.schedule[0], format_regulation_periods: regulation, status_period: 2, home_score: last.home_score, away_score: last.away_score }],
        });
        expect(sanityGate(rows(2))).toBeNull();
        expect(sanityGate(rows(4))).toBe('pbp: no plays in period 3');
    });
});
