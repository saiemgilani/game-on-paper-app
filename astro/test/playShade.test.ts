import { describe, expect, test } from 'vitest';
import { isTurnoverOnDowns, playShade } from '../src/utils/playShade';

const play = (extra: Record<string, unknown>) => ({
    type: { text: 'Rush' },
    text: '',
    start: { down: 4, distance: 2 },
    statYardage: 1,
    change_of_pos_team: false,
    downs_turnover: false,
    turnover_vec: false,
    penalty_flag: false,
    scoringPlay: false,
    ...extra,
});

describe('playShade', () => {
    test('4th-down penalty no-plays are penalties, not turnovers (DEN @ KC Q3 10:03)', () => {
        const delay = play({
            type: { text: 'Penalty' }, penalty_flag: true, statYardage: -5, start: { down: 4, distance: 7 },
            text: '(Punt formation) PENALTY on DEN, Delay of Game, 5 yards, enforced at KC 44 - No Play.',
        });
        const formation = play({
            type: { text: 'Penalty' }, penalty_flag: true, statYardage: 0, start: { down: 4, distance: 12 },
            text: 'J.Crawshaw punts 49 yards to end zone, Center-M.Fraboni, Touchback. PENALTY on KC-J.Royals, Illegal Formation, 5 yards, enforced at KC 49 - No Play.',
        });
        expect(playShade(delay)).toBe('table-warning');
        expect(playShade(formation)).toBe('table-warning');
    });

    test('same on the CFB side: 4th-down false start / delay of game (Missouri-Kansas 401856678, Oregon 401856782)', () => {
        const falseStart = play({
            type: { text: 'Penalty' }, statYardage: 5, start: { down: 4, distance: 9 },
            text: 'PENALTY MU False Start (#6 J.Beasley) 5 yards from MU42 to MU37. NO PLAY',
        });
        const delay = play({
            type: { text: 'Penalty' }, statYardage: 5, start: { down: 4, distance: 11 },
            text: 'PENALTY ORE Delay Of Game  5 yards from ORE24 to ORE19. NO PLAY',
        });
        expect(playShade(falseStart)).toBe('table-warning');
        expect(playShade(delay)).toBe('table-warning');
    });

    test('a real turnover on downs stays red (OSU @ TEX, downs_turnover=true)', () => {
        expect(playShade(play({ downs_turnover: true, statYardage: 1, start: { down: 4, distance: 2 } }))).toBe('table-danger');
    });

    test('a 4th-down conversion short of the sticks but flagged not-downs is not red', () => {
        // the processor says possession was kept; trust it over yardage arithmetic
        expect(playShade(play({ downs_turnover: false, statYardage: 1, start: { down: 4, distance: 2 } }))).toBe('');
    });

    test('interceptions, lost fumbles and turnover_vec plays are red', () => {
        expect(playShade(play({ type: { text: 'Interception Return' }, start: { down: 2, distance: 8 } }))).toBe('table-danger');
        expect(playShade(play({ text: 'fumble recovered by KC', change_of_pos_team: true, start: { down: 1, distance: 10 } }))).toBe('table-danger');
        expect(playShade(play({ turnover_vec: true, start: { down: 1, distance: 10 } }))).toBe('table-danger');
    });

    test('scores are green, penalties yellow', () => {
        expect(playShade(play({ scoringPlay: true, start: { down: 1, distance: 10 }, statYardage: 60 }))).toBe('table-success');
        expect(playShade(play({ text: 'PENALTY on KC, Holding', start: { down: 2, distance: 10 } }))).toBe('table-warning');
    });
});

describe('isTurnoverOnDowns without the downs_turnover field (legacy payloads)', () => {
    const legacy = (extra: Record<string, unknown>) => {
        const p: Record<string, unknown> = play(extra);
        delete p.downs_turnover;
        return p;
    };
    test('short of the line on 4th down still counts', () => {
        expect(isTurnoverOnDowns(legacy({}))).toBe(true);
    });
    test('but never a penalty, no-play, punt, field goal or timeout', () => {
        expect(isTurnoverOnDowns(legacy({ type: { text: 'Penalty' } }))).toBe(false);
        expect(isTurnoverOnDowns(legacy({ text: 'False Start - No Play.' }))).toBe(false);
        expect(isTurnoverOnDowns(legacy({ type: { text: 'Punt' } }))).toBe(false);
        expect(isTurnoverOnDowns(legacy({ type: { text: 'Field Goal Good' } }))).toBe(false);
        expect(isTurnoverOnDowns(legacy({ type: { text: 'Timeout' } }))).toBe(false);
    });
});
