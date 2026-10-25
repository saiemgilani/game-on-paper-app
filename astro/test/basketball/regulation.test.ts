// astro/test/basketball/regulation.test.ts
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
        expect(sanityGate(api, 'nba')).toBeNull();
    });
    test('the processor path: regulation_periods when present, the season rule when absent (the pre-PR fixture)', () => {
        const proc = read('game_401766458_processor');
        expect(proc.regulation_periods).toBeUndefined();
        const a = fromProcessor(proc, 'nba');
        const b = fromProcessor({ ...proc, regulation_periods: 4 }, 'nba');
        expect([a.season, a.regulation, a.periodKind, a.hasOvertime]).toEqual([2025, 4, 'quarter', false]);
        expect(b).toEqual(a);
        expect(fromProcessor(proc, 'nba')).toEqual(a); // the explicit NBA call
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

// Self-review on #324: the data value wins only when the league played that shape (WBB/WNBA halves eras, pinned in
// test/basketball/config.test.ts). The NBA never played halves, so a "2" in its data is ignored, not believed.
describe('a regulation shape the league never played is ignored (mutations of the real fixtures)', () => {
    beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });
    // mutation: no real NBA game has halves
    test('processor: regulation_periods 2 on an NBA game keeps quarters; its 4 periods are not overtime', () => {
        const proc = read('game_401766458_processor');
        const g = fromProcessor({ ...proc, regulation_periods: 2 }, 'nba');
        expect([g.regulation, g.periodKind, g.periods, g.hasOvertime]).toEqual([4, 'quarter', proc.periods, false]);
    });
    // mutation: no real NBA game has halves
    test('Data API: format_regulation_periods 2.0 on an NBA game keeps quarters', () => {
        const api = read('game_401766458_api');
        expect(scheduleRegulation({ ...api.schedule[0], format_regulation_periods: 2.0 }, 'nba').periods).toBe(4);
    });
    // mutation: no real NBA game has halves
    test('sanity gate: a two-period NBA final fails whatever its data claims', () => {
        const api = read('game_401766458_api');
        const pbp = api.pbp.filter((r: any) => Number(r.period_number) <= 2);
        const ns = new Set(pbp.map((r: any) => r.game_play_number));
        const last = [...pbp].sort((a: any, b: any) => a.game_play_number - b.game_play_number).at(-1);
        const rows = (regulation: number) => ({
            ...api, pbp, play_wp: api.play_wp.filter((w: any) => ns.has(w.game_play_number)),
            schedule: [{ ...api.schedule[0], format_regulation_periods: regulation, status_period: 2, home_score: last.home_score, away_score: last.away_score }],
        });
        expect(sanityGate(rows(2), 'nba')).toBe('pbp: no plays in period 3');
        expect(sanityGate(rows(4), 'nba')).toBe('pbp: no plays in period 3');
    });
});
