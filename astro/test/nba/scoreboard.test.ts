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
        expect(parseDateParam(null, today, '1997-10-01')).toEqual({ ok: true, date: today });
        expect(parseDateParam('2025-04-15', today, '1997-10-01')).toEqual({ ok: true, date: '2025-04-15' });
    });
    test('format, calendar and range failures name their reason', () => {
        expect(parseDateParam('20250415', today, '1997-10-01')).toEqual({ ok: false, reason: 'format' });
        expect(parseDateParam("2025-04-15' OR 1=1", today, '1997-10-01')).toEqual({ ok: false, reason: 'format' });
        expect(parseDateParam('2025-02-30', today, '1997-10-01')).toEqual({ ok: false, reason: 'calendar' });
        expect(parseDateParam('1997-09-30', today, '1997-10-01')).toEqual({ ok: false, reason: 'range' });
        expect(parseDateParam('1997-10-01', today, '1997-10-01')).toEqual({ ok: true, date: '1997-10-01' });
        expect(parseDateParam('2026-10-25', today, '1997-10-01')).toEqual({ ok: true, date: '2026-10-25' });
        expect(parseDateParam('2026-10-26', today, '1997-10-01')).toEqual({ ok: false, reason: 'range' });
    });
});

describe('dayNav and toEspnDate', () => {
    test('steps calendar days across a month boundary and labels the day in words', () => {
        expect(dayNav('2026-10-31')).toEqual({ prev: '2026-10-30', next: '2026-11-01', label: 'Saturday, October 31' });
        expect(toEspnDate('2026-10-11')).toBe('20261011');
    });
});

// Fix round 1: regressions for the status line, live/delayed ordering, postponed/canceled rank and English headings.
const typed = (name: string, state: string, detail: string, extra: Record<string, unknown> = {}) => ({
    clock: 0, displayClock: '0.0', period: 1,
    type: { id: '1', name, state, completed: false, description: detail, detail, shortDetail: detail },
    ...extra,
}) as any;
const evs = (id: string, date: string, name: string, state = 'post') => ({ id, date, competitions: [{ competitors: [] }], status: typed(name, state, 'x') }) as any;

describe('statusLine without a usable period or clock', () => {
    test('a live game with period 0 falls back to the status detail, not "Q0 1:00"', () => {
        expect(statusLine(typed('STATUS_IN_PROGRESS', 'in', 'Tip-off pending', { period: 0, displayClock: '1:00' }))).toEqual({ kind: 'live', text: 'Tip-off pending' });
    });
    test('a live game with no clock omits the clock instead of printing "undefined"', () => {
        expect(statusLine(typed('STATUS_IN_PROGRESS', 'in', 'x', { period: 2, displayClock: undefined })).text).toBe('Q2');
        expect(statusLine(typed('STATUS_IN_PROGRESS', 'in', 'x', { period: 2, displayClock: '  ' })).text).toBe('Q2');
    });
    test('end of period with period 0 falls back to the status detail, not "End of "', () => {
        expect(statusLine(typed('STATUS_END_PERIOD', 'in', 'End of period', { period: 0 })).text).toBe('End of period');
    });
});

describe('sortScoreboard for interrupted and cancelled games', () => {
    test('a mid-game delay or suspension sorts with the live games; a pre-game delay stays scheduled', () => {
        const out = sortScoreboard([
            evs('f', '2026-10-21T20:00Z', 'STATUS_FINAL'),
            evs('pp', '2026-10-21T10:00Z', 'STATUS_POSTPONED'),
            evs('cc', '2026-10-21T10:30Z', 'STATUS_CANCELED'),
            evs('s', '2026-10-22T03:00Z', 'STATUS_SCHEDULED', 'pre'),
            evs('d2', '2026-10-22T02:00Z', 'STATUS_DELAYED', 'pre'),
            evs('d1', '2026-10-22T01:00Z', 'STATUS_DELAYED', 'in'),
            evs('su', '2026-10-22T00:30Z', 'STATUS_SUSPENDED', 'in'),
        ]);
        expect(out.map((e) => e.id)).toEqual(['su', 'd1', 'd2', 's', 'f', 'pp', 'cc']);
    });
});

describe('statusLine for interrupted games', () => {
    test('a delayed or suspended game shows its detail', () => {
        expect(statusLine(typed('STATUS_SUSPENDED', 'in', 'Suspended - power outage', { period: 3 }))).toEqual({ kind: 'other', text: 'Suspended - power outage' });
    });
});

describe('dayNav is never localised', () => {
    test('the heading stays English whatever the default locale', async () => {
        const { Settings } = await import('luxon');
        const prior = Settings.defaultLocale;
        Settings.defaultLocale = 'fr-FR';
        try {
            expect(dayNav('2026-10-31').label).toBe('Saturday, October 31');
        } finally {
            Settings.defaultLocale = prior;
        }
    });
});

describe('parseDateParam boundaries', () => {
    test('a non-leap February 29 is a calendar error', () => {
        expect(parseDateParam('2025-02-29', '2026-10-11', '1997-10-01')).toEqual({ ok: false, reason: 'calendar' });
    });
    test('today + 14 is in range and today + 15 is out, across a month boundary', () => {
        const today = '2026-10-17';
        expect(parseDateParam('2026-10-31', today, '1997-10-01')).toEqual({ ok: true, date: '2026-10-31' });
        expect(parseDateParam('2026-11-01', today, '1997-10-01')).toEqual({ ok: false, reason: 'range' });
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
