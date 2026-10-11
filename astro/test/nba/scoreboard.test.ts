import { describe, expect, test } from 'vitest';
import { dayNav, gameLeaders, parseDateParam, sortScoreboard, statusLine, toEspnDate } from '../../src/nba/scoreboard';

const status = (name: string, extra: Record<string, unknown> = {}) => ({
    clock: 0, displayClock: '0.0', period: 4,
    type: { id: '3', name, state: 'post', completed: name === 'STATUS_FINAL', description: 'x', detail: 'x', shortDetail: 'x' },
    ...extra,
}) as any;
const ev = (id: string, date: string, name: string) => ({ id, date, competitions: [{ competitors: [] }], status: status(name) }) as any;

describe('sortScoreboard', () => {
    test('in progress, then scheduled by tip, then finals by tip', () => {
        const out = sortScoreboard([
            ev('f2', '2026-10-21T23:30Z', 'STATUS_FINAL'), ev('s2', '2026-10-22T02:00Z', 'STATUS_SCHEDULED'),
            ev('h', '2026-10-22T00:00Z', 'STATUS_HALFTIME'), ev('s1', '2026-10-22T00:30Z', 'STATUS_SCHEDULED'),
            ev('e3', '2026-10-21T23:00Z', 'STATUS_END_PERIOD'), ev('f1', '2026-10-21T23:00Z', 'STATUS_FINAL'),
        ]);
        expect(out.map((e) => e.id)).toEqual(['e3', 'h', 's1', 's2', 'f1', 'f2']);
    });
});

describe('statusLine', () => {
    test('scheduled, live with period and clock, end of period, halftime, final, final/OT', () => {
        expect(statusLine(status('STATUS_SCHEDULED', { period: 0 })).kind).toBe('scheduled');
        expect(statusLine(status('STATUS_IN_PROGRESS', { period: 3, displayClock: '4:12' }))).toEqual({ kind: 'live', text: 'Q3 4:12' });
        expect(statusLine(status('STATUS_IN_PROGRESS', { period: 5, displayClock: '1:00' })).text).toBe('OT 1:00');
        expect(statusLine(status('STATUS_IN_PROGRESS', { period: 6, displayClock: '1:00' })).text).toBe('2OT 1:00');
        expect(statusLine(status('STATUS_END_PERIOD', { period: 3 })).text).toBe('End of 3rd');
        expect(statusLine(status('STATUS_HALFTIME', { period: 2 })).text).toBe('Halftime');
        expect(statusLine(status('STATUS_FINAL', { period: 4 }))).toEqual({ kind: 'final', text: 'Final' });
        expect(statusLine(status('STATUS_FINAL', { period: 5 })).text).toBe('Final/OT');
        expect(statusLine(status('STATUS_FINAL', { period: 6 })).text).toBe('Final/2OT');
        expect(statusLine(status('STATUS_POSTPONED', { period: 0 })).kind).toBe('other');
    });
});

describe('parseDateParam', () => {
    const today = '2026-10-11';
    test('absent is today; a valid day in range passes', () => {
        expect(parseDateParam(null, today)).toEqual({ ok: true, date: today });
        expect(parseDateParam('2025-04-15', today)).toEqual({ ok: true, date: '2025-04-15' });
    });
    test('format, calendar and range failures name their reason', () => {
        expect(parseDateParam('20250415', today)).toEqual({ ok: false, reason: 'format' });
        expect(parseDateParam("2025-04-15' OR 1=1", today)).toEqual({ ok: false, reason: 'format' });
        expect(parseDateParam('2025-02-30', today)).toEqual({ ok: false, reason: 'calendar' });
        expect(parseDateParam('1997-09-30', today)).toEqual({ ok: false, reason: 'range' });
        expect(parseDateParam('1997-10-01', today)).toEqual({ ok: true, date: '1997-10-01' });
        expect(parseDateParam('2026-10-25', today)).toEqual({ ok: true, date: '2026-10-25' });
        expect(parseDateParam('2026-10-26', today)).toEqual({ ok: false, reason: 'range' });
    });
});

describe('dayNav and toEspnDate', () => {
    test('steps calendar days across a month boundary and labels the day in words', () => {
        expect(dayNav('2026-10-31')).toEqual({ prev: '2026-10-30', next: '2026-11-01', label: 'Saturday, October 31' });
        expect(toEspnDate('2026-10-11')).toBe('20261011');
    });
});

describe('gameLeaders', () => {
    test('reads points, rebounds and assists and tolerates a missing block', () => {
        const comp = { leaders: [
            { name: 'points', leaders: [{ displayValue: '26', athlete: { shortName: 'C. Anthony' } }] },
            { name: 'rebounds', leaders: [{ displayValue: '13', athlete: { shortName: 'F. Wagner' } }] },
            { name: 'rating', leaders: [{ displayValue: '26 PTS', athlete: { shortName: 'C. Anthony' } }] },
        ] } as any;
        expect(gameLeaders(comp)).toEqual({ pts: '26 C. Anthony', reb: '13 F. Wagner' });
        expect(gameLeaders({} as any)).toEqual({});
    });
});
