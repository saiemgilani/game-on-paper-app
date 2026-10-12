import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { endOfPeriodText, finalText, islandPeriodProps, linescoreLabel, periodLong, periodShort, wpMarkerGate, wpMarkerTitle } from '../../src/basketball/periods';
import { periodLong as legacyLong, periodShort as legacyShort } from '../../src/components/nba/game/periodLabel';
import { statusLine } from '../../src/nba/scoreboard';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());

describe('quarters (real NBA fixtures)', () => {
    test('the four periods of game 401766458 and its linescore columns', () => {
        const periods = [...new Set(read('game_401766458_processor').plays.map((p: any) => p.period_number))] as number[];
        expect(periods.map((p) => periodShort(p))).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
        expect(periods.map((p) => periodLong(p, 4, 'quarter'))).toEqual(['1st Quarter', '2nd Quarter', '3rd Quarter', '4th Quarter']);
        expect([0, 1, 2, 3, 4, 5].map((i) => linescoreLabel(i, 4))).toEqual(['1', '2', '3', '4', 'OT', '2OT']);
    });
    test('the 2025-01-15 scoreboard: one OT final, three regulation finals, regulation read from each event', () => {
        const events = read('scoreboard-20250115').content.sbData.events;
        const lines = events.map((e: any) => statusLine(e.competitions[0].status, e.competitions[0].format.regulation.periods, 'quarter').text);
        expect(lines).toEqual(['Final/OT', 'Final', 'Final', 'Final']);
        expect(events.map((e: any) => statusLine(e.competitions[0].status).text)).toEqual(lines); // the one-argument NBA call is unchanged
    });
    test('overtime numbering and the old periodLabel exports are the same functions', () => {
        for (let p = 1; p <= 9; p++) {
            expect(legacyShort(p)).toBe(periodShort(p, 4, 'quarter'));
            expect(legacyLong(p)).toBe(periodLong(p, 4, 'quarter'));
        }
        expect([5, 6, 7, 8, 9].map((p) => periodLong(p))).toEqual(['Overtime', '2nd Overtime', '3rd Overtime', '4th Overtime', '5th Overtime']);
        expect(endOfPeriodText(1)).toBe('End of 1st');
        expect(endOfPeriodText(5)).toBe('End of OT');
        expect(finalText(6)).toBe('Final/2OT');
    });
});

describe('halves (spec §3.1: MBB always, WNBA before 2006, WBB before 2015-16)', () => {
    test('labels', () => {
        expect([1, 2, 3, 4].map((p) => periodShort(p, 2, 'half'))).toEqual(['H1', 'H2', 'OT', '2OT']);
        expect([1, 2, 3, 4].map((p) => periodLong(p, 2, 'half'))).toEqual(['1st Half', '2nd Half', 'Overtime', '2nd Overtime']);
        expect([0, 1, 2, 3].map((i) => linescoreLabel(i, 2))).toEqual(['1', '2', 'OT', '2OT']);
        expect(endOfPeriodText(1, 2, 'half')).toBe('End of 1st Half');
        expect(endOfPeriodText(3, 2, 'half')).toBe('End of OT');
        expect(finalText(2, 2, 'half')).toBe('Final');
        expect(finalText(3, 2, 'half')).toBe('Final/OT');
    });
    test('statusLine reads the regulation, never a quarter count', () => {
        const st = (name: string, period: number, clock = '') => ({ period, displayClock: clock, type: { name, detail: 'd' } }) as any;
        expect(statusLine(st('STATUS_FINAL', 3), 2, 'half').text).toBe('Final/OT');
        expect(statusLine(st('STATUS_FINAL', 2), 2, 'half').text).toBe('Final');
        expect(statusLine(st('STATUS_END_PERIOD', 1), 2, 'half').text).toBe('End of 1st Half');
        // D14 live states plans #5/#8/#10 rely on (literal ESPN status inputs)
        expect(statusLine(st('STATUS_HALFTIME', 1), 2, 'half').text).toBe('Halftime');
        expect(statusLine(st('STATUS_HALFTIME', 1), 2, 'half').kind).toBe('live');
        expect(statusLine(st('STATUS_END_PERIOD', 2), 2, 'half').text).toBe('End of 2nd Half');
        expect(endOfPeriodText(2, 2, 'half')).toBe('End of 2nd Half');
        expect(statusLine(st('STATUS_IN_PROGRESS', 2, '5:32'), 2, 'half').text).toBe('H2 5:32');
        expect(statusLine(st('STATUS_IN_PROGRESS', 3, '1:00'), 2, 'half').text).toBe('OT 1:00');
    });
    test('island props are empty for 4 quarters, so no NBA or football island changes', () => {
        expect(islandPeriodProps(4, 'quarter')).toEqual({});
        expect(islandPeriodProps(2, 'half')).toEqual({ regulationPeriods: 2, periodKind: 'half' });
    });
});

describe('WinProbabilityChart markers: football byte-identical (Review Focus 2)', () => {
    // the inline expressions removed from WinProbabilityChart.svelte:192-195 on 81dbaf1e, kept here as the oracle
    const oldGate = (per: number, all: boolean) => all || per <= 5;
    const oldTitle = (per: number, all: boolean) => (per < 5 ? `Q${per}` : all && per > 5 ? `${per - 4}OT` : 'OT');
    test('periods 1-9, both modes', () => {
        for (const all of [false, true]) for (let per = 1; per <= 9; per++) {
            expect(wpMarkerGate(per, all)).toBe(oldGate(per, all));
            expect(wpMarkerTitle(per, all)).toBe(oldTitle(per, all));
        }
    });
    test('halves', () => {
        expect([1, 2, 3, 4].map((p) => wpMarkerTitle(p, true, 2, 'half'))).toEqual(['H1', 'H2', 'OT', '2OT']);
        expect(wpMarkerGate(4, false, 2)).toBe(false);
    });
});
