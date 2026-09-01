import { describe, expect, test } from 'vitest';
import { PLAY_ICON_ORDER, playIcons } from '../src/utils/playIcons';

const play = (flags: Record<string, boolean>, typeText = 'Rush') => ({ type: { text: typeText }, ...flags });

describe('playIcons', () => {
    test('a plain play carries no mark', () => {
        expect(playIcons(play({}))).toEqual([]);
        expect(playIcons(null)).toEqual([]);
    });

    test('routine kicks carry no mark by design', () => {
        expect(playIcons(play({ punt: true }, 'Punt'))).toEqual([]);
        expect(playIcons(play({ kickoff_play: true }, 'Kickoff'))).toEqual([]);
    });

    test('stacks in field order: strip-sack, scoop and score', () => {
        expect(playIcons(play({ sack: true, fumble_lost: true, touchdown: true, turnover_vec: true }, 'Fumble Return Touchdown')))
            .toEqual(['sack', 'fumble', 'td']);
    });

    test('pick-six shows the pick and the score', () => {
        expect(playIcons(play({ int: true, touchdown: true, turnover_vec: true }, 'Interception Return Touchdown'))).toEqual(['int', 'td']);
    });

    test('a blocked field goal is a block, not a miss', () => {
        expect(playIcons(play({ fg_attempt: true, fg_made: false, is_blocked_fg_turnover: true }))).toEqual(['blocked']);
        expect(playIcons(play({ punt: true, punt_blocked: true }, 'Blocked Punt'))).toEqual(['blocked']);
        // fallback for payloads that only carry turnover_vec + the type text
        expect(playIcons(play({ fg_attempt: true, fg_made: false, turnover_vec: true }, 'Blocked Field Goal'))).toEqual(['blocked']);
        expect(playIcons(play({ fg_attempt: true, fg_made: false }, 'Field Goal Missed'))).toEqual(['fg-miss']);
        expect(playIcons(play({ fg_attempt: true, fg_made: true }, 'Field Goal Good'))).toEqual(['fg']);
    });

    test('fumble needs a change of possession unless the pipeline says fumble_lost', () => {
        expect(playIcons(play({ fumble_vec: true }))).toEqual([]);
        expect(playIcons(play({ fumble_vec: true, change_of_pos_team: true }))).toEqual(['fumble']);
        expect(playIcons(play({ fumble_lost: true }))).toEqual(['fumble']);
    });

    test('downs, safety, penalty and explosive each map to one mark; flag and bolt trail', () => {
        expect(playIcons(play({ downs_turnover: true, penalty_flag: true }))).toEqual(['downs', 'penalty']);
        expect(playIcons(play({ sack: true, safety: true }))).toEqual(['sack', 'safety']);
        expect(playIcons(play({ touchdown: true, EPA_explosive: true }))).toEqual(['td', 'explosive']);
    });

    test('output order always follows PLAY_ICON_ORDER', () => {
        const all = playIcons(play({ sack: true, int: true, fumble_lost: true, downs_turnover: true, fg_made: true, safety: true, touchdown: true, penalty_flag: true, EPA_explosive: true }));
        const idx = all.map((id) => PLAY_ICON_ORDER.indexOf(id));
        expect(idx).toEqual([...idx].sort((a, b) => a - b));
    });
});
