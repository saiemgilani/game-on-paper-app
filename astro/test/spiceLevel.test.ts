import { describe, expect, test } from 'vitest';
import { calculateSpiceLevel, SPICE_LABEL, SpiceLevel } from '../src/utils/misc';

// G12, Akshay's sign-off note: "add tests that the border logic works as the
// scoreboard states it". The scoreboard's legend (SchedulePage.astro) says:
//   Gray - normal | Green - close game late | Yellow - ranked upset |
//   Orange - ranked opponents + close game late | Red - FCS upset
// Each block below pins one of those claims to calculateSpiceLevel, plus the
// order the checks run in when a game qualifies for more than one colour.

const FBS = '8'; // SEC
const FCS = '20'; // not in FBS_CONFERENCES

type Side = { score: number; rank?: number; conf?: string };
function game(opts: {
    period: number; clock: number; home: Side; away: Side;
    name?: string; completed?: boolean; detail?: string;
}): any {
    const competitor = (s: Side, id: string) => ({
        id,
        score: String(s.score),
        team: { id, conferenceId: s.conf ?? FBS },
        curatedRank: { current: s.rank ?? 99 },
    });
    return {
        id: '1',
        status: {
            period: opts.period,
            clock: opts.clock,
            type: {
                name: opts.name ?? 'STATUS_IN_PROGRESS',
                completed: opts.completed ?? false,
                detail: opts.detail ?? 'in progress',
            },
        },
        // competitors[0] is home, [1] away (ESPN's order, as GameThumb reads it)
        competitions: [{ competitors: [competitor(opts.home, '10'), competitor(opts.away, '20')] }],
    };
}
const MIN = 60;

describe('Gray - normal', () => {
    test('a scheduled, final, cancelled or postponed game is never spiced, however close', () => {
        const close = { home: { score: 21, rank: 3 }, away: { score: 20, rank: 4 } };
        expect(calculateSpiceLevel(game({ ...close, period: 0, clock: 0, name: 'STATUS_SCHEDULED' }))).toBe(SpiceLevel.BELL);
        expect(calculateSpiceLevel(game({ ...close, period: 4, clock: 0, name: 'STATUS_FINAL', completed: true }))).toBe(SpiceLevel.BELL);
        expect(calculateSpiceLevel(game({ ...close, period: 4, clock: 2 * MIN, detail: 'Canceled' }))).toBe(SpiceLevel.BELL);
        expect(calculateSpiceLevel(game({ ...close, period: 4, clock: 2 * MIN, detail: 'Postponed' }))).toBe(SpiceLevel.BELL);
    });

    test('garbage time is gray even for an FCS team ahead: >38 in Q2, >28 in Q3, >22 in Q4', () => {
        const fcsRout = (period: number, margin: number) =>
            calculateSpiceLevel(game({ period, clock: 2 * MIN, home: { score: margin, conf: FCS }, away: { score: 0 } }));
        expect(fcsRout(2, 39)).toBe(SpiceLevel.BELL);
        expect(fcsRout(3, 29)).toBe(SpiceLevel.BELL);
        expect(fcsRout(4, 23)).toBe(SpiceLevel.BELL);
        // one point inside each threshold is not garbage time
        expect(fcsRout(4, 22)).toBe(SpiceLevel.REAPER);
    });

    test('a close game early, or late but not close, stays gray', () => {
        expect(calculateSpiceLevel(game({ period: 1, clock: 12 * MIN, home: { score: 7 }, away: { score: 7 } }))).toBe(SpiceLevel.BELL);
        expect(calculateSpiceLevel(game({ period: 4, clock: 10 * MIN, home: { score: 21 }, away: { score: 17 } }))).toBe(SpiceLevel.BELL);
        expect(calculateSpiceLevel(game({ period: 4, clock: 3 * MIN, home: { score: 38 }, away: { score: 17 } }))).toBe(SpiceLevel.BELL);
    });
});

describe('Green - close game late', () => {
    test('one score (<= 8) inside the last 5:00 of the 2nd or 4th quarter', () => {
        expect(calculateSpiceLevel(game({ period: 4, clock: 4 * MIN, home: { score: 24 }, away: { score: 17 } }))).toBe(SpiceLevel.SERRANO);
        expect(calculateSpiceLevel(game({ period: 2, clock: 4 * MIN, home: { score: 10 }, away: { score: 14 } }))).toBe(SpiceLevel.SERRANO);
    });

    test('two scores (9-16) count while there are 2:00 left to score twice', () => {
        expect(calculateSpiceLevel(game({ period: 4, clock: 3 * MIN, home: { score: 30 }, away: { score: 16 } }))).toBe(SpiceLevel.SERRANO);
        expect(calculateSpiceLevel(game({ period: 4, clock: 1 * MIN, home: { score: 30 }, away: { score: 16 } }))).toBe(SpiceLevel.BELL);
    });

    test('a one-possession game in the final minute is still green', () => {
        expect(calculateSpiceLevel(game({ period: 4, clock: 30, home: { score: 20 }, away: { score: 17 } }))).toBe(SpiceLevel.SERRANO);
    });

    test('overtime is late', () => {
        expect(calculateSpiceLevel(game({ period: 5, clock: 0, home: { score: 27 }, away: { score: 27 } }))).toBe(SpiceLevel.SERRANO);
    });

    test('the 5:00 line: 5:01 left is not late, 5:00 is', () => {
        const at = (clock: number) => calculateSpiceLevel(game({ period: 4, clock, home: { score: 24 }, away: { score: 21 } }));
        expect(at(5 * MIN + 1)).toBe(SpiceLevel.BELL);
        expect(at(5 * MIN)).toBe(SpiceLevel.SERRANO);
    });

    test('one ranked team is still green late (the yellow check needs 3rd/4th quarter, <= 7:30)', () => {
        // Q2 late: the ranked-upset window (period >= 3) is closed, so green
        expect(calculateSpiceLevel(game({ period: 2, clock: 2 * MIN, home: { score: 14, rank: 5 }, away: { score: 10 } }))).toBe(SpiceLevel.SERRANO);
    });
});

describe('Orange - ranked opponents + close game late', () => {
    test('both teams ranked, close, late', () => {
        expect(calculateSpiceLevel(game({ period: 4, clock: 3 * MIN, home: { score: 24, rank: 4 }, away: { score: 21, rank: 11 } }))).toBe(SpiceLevel.GHOST);
    });

    test('both ranked but not late is not orange', () => {
        expect(calculateSpiceLevel(game({ period: 3, clock: 10 * MIN, home: { score: 24, rank: 4 }, away: { score: 21, rank: 11 } }))).toBe(SpiceLevel.BELL);
    });

    test('ranked means curatedRank <= 25', () => {
        expect(calculateSpiceLevel(game({ period: 4, clock: 3 * MIN, home: { score: 24, rank: 25 }, away: { score: 21, rank: 1 } }))).toBe(SpiceLevel.GHOST);
        // 26 is unranked, so this is ranked v unranked (yellow, which runs first)
        expect(calculateSpiceLevel(game({ period: 4, clock: 3 * MIN, home: { score: 24, rank: 26 }, away: { score: 21, rank: 1 } }))).toBe(SpiceLevel.CAYENNE);
    });
});

describe('Yellow - ranked upset', () => {
    test('ranked v unranked within one or two scores, 3rd/4th quarter, <= 7:30 left', () => {
        expect(calculateSpiceLevel(game({ period: 3, clock: 6 * MIN, home: { score: 17, rank: 8 }, away: { score: 20 } }))).toBe(SpiceLevel.CAYENNE);
        expect(calculateSpiceLevel(game({ period: 4, clock: 7 * MIN, home: { score: 10 }, away: { score: 14, rank: 2 } }))).toBe(SpiceLevel.CAYENNE);
    });

    test('outside the window it is not yellow: 7:31 left, or a three-score game', () => {
        expect(calculateSpiceLevel(game({ period: 3, clock: 7 * MIN + 31, home: { score: 17, rank: 8 }, away: { score: 20 } }))).toBe(SpiceLevel.BELL);
        expect(calculateSpiceLevel(game({ period: 3, clock: 6 * MIN, home: { score: 3, rank: 8 }, away: { score: 20 } }))).toBe(SpiceLevel.BELL);
    });

    // AS THE LOGIC STANDS (open question for Akshay on the G12 PR): "upset"
    // here means upset WATCH. The check never asks who leads, so a ranked team
    // AHEAD of an unranked one by a score is yellow too.
    test('current behaviour: a ranked team leading an unranked one by 8 is yellow', () => {
        expect(calculateSpiceLevel(game({ period: 4, clock: 6 * MIN, home: { score: 28, rank: 3 }, away: { score: 20 } }))).toBe(SpiceLevel.CAYENNE);
    });

    test('yellow outranks green: ranked v unranked, close and late in the 4th', () => {
        expect(calculateSpiceLevel(game({ period: 4, clock: 2 * MIN, home: { score: 21, rank: 6 }, away: { score: 24 } }))).toBe(SpiceLevel.CAYENNE);
    });
});

describe('Red - FCS upset', () => {
    test('an FCS team ahead of an FBS team after the first 7:30, home or away', () => {
        expect(calculateSpiceLevel(game({ period: 2, clock: 10 * MIN, home: { score: 14, conf: FCS }, away: { score: 7 } }))).toBe(SpiceLevel.REAPER);
        expect(calculateSpiceLevel(game({ period: 3, clock: 10 * MIN, home: { score: 7 }, away: { score: 14, conf: FCS } }))).toBe(SpiceLevel.REAPER);
    });

    test('the FBS team ahead is not red', () => {
        expect(calculateSpiceLevel(game({ period: 3, clock: 10 * MIN, home: { score: 21 }, away: { score: 14, conf: FCS } }))).toBe(SpiceLevel.BELL);
    });

    test('the first 7:30 of the game is never red', () => {
        expect(calculateSpiceLevel(game({ period: 1, clock: 8 * MIN, home: { score: 7, conf: FCS }, away: { score: 0 } }))).toBe(SpiceLevel.BELL);
    });

    // AS THE LOGIC STANDS (open question for Akshay): a TIE counts as the FCS
    // team leading, so an FBS-FCS game tied 0-0 with 7:29 left in the 1st is red.
    test('current behaviour: a tied FBS-FCS game is red once the first 7:30 is gone', () => {
        expect(calculateSpiceLevel(game({ period: 1, clock: 7 * MIN, home: { score: 0, conf: FCS }, away: { score: 0 } }))).toBe(SpiceLevel.REAPER);
    });

    test('two FCS teams, or two FBS teams, are never red', () => {
        expect(calculateSpiceLevel(game({ period: 3, clock: 10 * MIN, home: { score: 14, conf: FCS }, away: { score: 7, conf: FCS } }))).toBe(SpiceLevel.BELL);
    });

    test('red outranks green, and yellow outranks red', () => {
        // FCS ahead, close and late: red, not green
        expect(calculateSpiceLevel(game({ period: 4, clock: 2 * MIN, home: { score: 17, conf: FCS }, away: { score: 14 } }))).toBe(SpiceLevel.REAPER);
        // FCS ahead of a RANKED FBS team in the yellow window: yellow runs first
        expect(calculateSpiceLevel(game({ period: 4, clock: 6 * MIN, home: { score: 17, conf: FCS }, away: { score: 14, rank: 9 } }))).toBe(SpiceLevel.CAYENNE);
    });
});

describe('SPICE_LABEL: the words for each colour', () => {
    test('every level that draws a coloured border has words; gray and the test level have none', () => {
        expect(SPICE_LABEL).toEqual({
            testing: null,
            none: null,
            'close-late': 'Close late',
            'ranked-upset': 'Ranked upset',
            'ranked-close-late': 'Ranked, close late',
            'fcs-upset': 'FCS upset',
        });
    });
});
