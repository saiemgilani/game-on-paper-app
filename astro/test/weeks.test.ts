import { describe, expect, test } from 'vitest';
import { adjacentWeeks, weekHref, weeksFor } from '../src/resources/schedule';

// The week list the schedule picker shows, and the neighbours the week stepper
// links to. cfb reads the real static/schedule.json, so the postseason entries
// are the ones ESPN publishes (Bowls = type 3 / week 1, CFP = type 3 / week 999).

describe('weeksFor', () => {
    test('cfb reads the schedule map in order, with numeric type/value', () => {
        const w = weeksFor('cfb', 2025);
        expect(w).toHaveLength(18);
        expect(w[0]).toMatchObject({ type: 2, value: 1, label: 'Week 1' });
        expect(w.at(-2)).toMatchObject({ type: 3, value: 1, label: 'Bowls' });
        expect(w.at(-1)).toMatchObject({ type: 3, value: 999, label: 'CFP' });
    });
    test('nfl is 18 regular weeks then the postseason rounds', () => {
        const w = weeksFor('nfl', 2025);
        expect(w).toHaveLength(23);
        expect(w[17]).toMatchObject({ type: 2, value: 18, label: 'Week 18' });
        expect(w[18]).toMatchObject({ type: 3, value: 1, label: 'Wild Card' });
        expect(w.at(-1)).toMatchObject({ type: 3, value: 5, label: 'Super Bowl' });
    });
    test('a season outside the map has no weeks', () => {
        expect(weeksFor('cfb', 1990)).toEqual([]);
    });
});

describe('adjacentWeeks', () => {
    const cfb = weeksFor('cfb', 2025);
    const nfl = weeksFor('nfl', 2025);
    test('mid-season steps by one', () => {
        const n = adjacentWeeks(cfb, 2, 5)!;
        expect(n.current.label).toBe('Week 5');
        expect(n.prev!.label).toBe('Week 4');
        expect(n.next!.label).toBe('Week 6');
    });
    test('cfb: the last regular week steps into the postseason entries, not week + 1', () => {
        expect(adjacentWeeks(cfb, 2, 16)!.next).toMatchObject({ type: 3, value: 1, label: 'Bowls' });
        expect(adjacentWeeks(cfb, 3, 1)!.prev).toMatchObject({ type: 2, value: 16, label: 'Week 16' });
        expect(adjacentWeeks(cfb, 3, 1)!.next).toMatchObject({ type: 3, value: 999, label: 'CFP' });
        expect(adjacentWeeks(cfb, 3, 999)!.prev).toMatchObject({ type: 3, value: 1, label: 'Bowls' });
    });
    test('nfl: week 18 steps into the Wild Card round and back', () => {
        expect(adjacentWeeks(nfl, 2, 18)!.next).toMatchObject({ type: 3, value: 1, label: 'Wild Card' });
        expect(adjacentWeeks(nfl, 3, 1)!.prev).toMatchObject({ type: 2, value: 18, label: 'Week 18' });
    });
    test('the ends have no neighbour; a week not in the list has no stepper', () => {
        expect(adjacentWeeks(cfb, 2, 1)!.prev).toBeNull();
        expect(adjacentWeeks(cfb, 3, 999)!.next).toBeNull();
        expect(adjacentWeeks(nfl, 2, 1)!.prev).toBeNull();
        expect(adjacentWeeks(nfl, 3, 5)!.next).toBeNull();
        expect(adjacentWeeks(cfb, 2, 40)).toBeNull();
    });
});

describe('weekHref', () => {
    test('league prefix, and the conference group rides along when set', () => {
        expect(weekHref('cfb', 2025, { type: 2, value: 4 }, 80)).toBe('/year/2025/type/2/week/4?group=80');
        expect(weekHref('cfb', 2025, { type: 3, value: 1 })).toBe('/year/2025/type/3/week/1');
        expect(weekHref('nfl', 2025, { type: 3, value: 2 })).toBe('/nfl/year/2025/type/3/week/2');
    });
});
