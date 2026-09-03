import { describe, expect, test } from 'vitest';
import { parseSpan, availableSpans, fmtAdjClock } from '../src/utils/span';

const p = (period: number | null, adj?: number) => ({ period, 'start.adj_TimeSecsRem': adj });

describe('parseSpan', () => {
    test('named spans select their periods', () => {
        expect(parseSpan('q3')!.test(p(3))).toBe(true);
        expect(parseSpan('q3')!.test(p(4))).toBe(false);
        expect(parseSpan('h1')!.test(p(2))).toBe(true);
        expect(parseSpan('h2')!.test(p(2))).toBe(false);
        expect(parseSpan('ot')!.test(p(5))).toBe(true);
        expect(parseSpan('ot')!.test(p(4))).toBe(false);
        expect(parseSpan('Q2')!.key).toBe('q2'); // case-insensitive
    });
    test('null periods never match anything', () => {
        for (const k of ['q1', 'h1', 'ot']) expect(parseSpan(k)!.test(p(null))).toBe(false);
    });
    test('clock ranges: inclusive window on the countdown clock, regulation only', () => {
        const s = parseSpan('1800-900')!; // Q2 end through Q3
        expect(s.test(p(3, 1200))).toBe(true);
        expect(s.test(p(2, 1800))).toBe(true);
        expect(s.test(p(1, 3000))).toBe(false);
        expect(s.test(p(4, 300))).toBe(false);
        expect(s.test(p(5, 1200))).toBe(false); // OT clock readings are not comparable
        expect(s.test(p(3, undefined))).toBe(false);
    });
    test('clock ranges normalize to 30s buckets and reject nonsense', () => {
        expect(parseSpan('1807-893')!.key).toBe('1800-900');
        expect(parseSpan('900-1800')).toBe(null); // backwards
        expect(parseSpan('900-900')).toBe(null);
        expect(parseSpan('banana')).toBe(null);
        expect(parseSpan('')).toBe(null);
        expect(parseSpan(null)).toBe(null);
    });
});

test('fmtAdjClock places the reading in its quarter', () => {
    expect(fmtAdjClock(3600)).toBe('Q1 15:00');
    expect(fmtAdjClock(2700)).toBe('Q2 15:00');
    expect(fmtAdjClock(1350)).toBe('Q3 7:30');
    expect(fmtAdjClock(0)).toBe('Q4 0:00');
});

test('availableSpans offers only played windows', () => {
    const reg = [p(1), p(2), p(3), p(4)];
    expect(availableSpans(reg).map((s) => s.key)).toEqual(['q1', 'q2', 'h1', 'q3', 'q4', 'h2']);
    expect(availableSpans([p(1), p(2)]).map((s) => s.key)).toEqual(['q1', 'q2', 'h1']);
    expect(availableSpans([...reg, p(5)]).map((s) => s.key)).toContain('ot');
    expect(availableSpans([p(null)])).toEqual([]);
});
