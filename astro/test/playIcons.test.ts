import { describe, expect, test } from 'vitest';
import { PLAY_ICON_ORDER, playIcons, threeAndOutPlays } from '../src/utils/playIcons';

const play = (flags: Record<string, unknown>, typeText = 'Rush') => ({ type: { text: typeText }, ...flags });

describe('playIcons', () => {
    test('a plain play, and routine kicks, carry no mark', () => {
        expect(playIcons(play({}))).toEqual([]);
        expect(playIcons(null)).toEqual([]);
        expect(playIcons(play({ punt: true }, 'Punt'))).toEqual([]);
        expect(playIcons(play({ kickoff_play: true }, 'Kickoff'))).toEqual([]);
    });

    test('touchdown carries its conversion result', () => {
        expect(playIcons(play({ touchdown: true }))).toEqual(['td']);
        expect(playIcons(play({ touchdown: true, xp_attempt: true, xp_made: true, extra_point_result: 'good' }))).toEqual(['td-xp']);
        expect(playIcons(play({ touchdown: true, xp_attempt: true, xp_made: false, extra_point_result: 'missed' }))).toEqual(['td-xp-miss']);
        expect(playIcons(play({ touchdown: true, two_point_conv_result: 'good' }))).toEqual(['td-2pt']);
        expect(playIcons(play({ touchdown: true, two_point_conv_result: 'failed' }))).toEqual(['td-2pt-miss']);
        // the API serialises absence as the string "None"
        expect(playIcons(play({ touchdown: true, two_point_conv_result: 'None', extra_point_result: 'None' }))).toEqual(['td']);
    });

    test('stacks in field order: strip-sack, scoop and score with the PAT', () => {
        expect(playIcons(play({ sack: true, fumble_lost: true, touchdown: true, xp_made: true, turnover_vec: true }, 'Fumble Return Touchdown')))
            .toEqual(['sack', 'fumble', 'td-xp']);
        expect(playIcons(play({ int: true, touchdown: true, turnover_vec: true }, 'Interception Return Touchdown'))).toEqual(['int', 'td']);
    });

    test('behind the line: sack beats TFL beats stuffed run (one mark)', () => {
        expect(playIcons(play({ sack: true, TFL: true, TFL_pass: true }))).toEqual(['sack']);
        expect(playIcons(play({ TFL: true, TFL_rush: true, stuffed_run: true }))).toEqual(['tfl']);
        expect(playIcons(play({ stuffed_run: true }))).toEqual(['stuffed']);
    });

    test('blocked kicks, missed kicks, downs and goal-line stands', () => {
        expect(playIcons(play({ fg_attempt: true, fg_made: false, is_blocked_fg_turnover: true }))).toEqual(['blocked']);
        expect(playIcons(play({ punt: true, punt_blocked: true }, 'Blocked Punt'))).toEqual(['blocked']);
        expect(playIcons(play({ fg_attempt: true, fg_made: false, turnover_vec: true }, 'Blocked Field Goal'))).toEqual(['blocked']);
        expect(playIcons(play({ fg_attempt: true, fg_made: false }, 'Field Goal Missed'))).toEqual(['fg-miss']);
        expect(playIcons(play({ fg_attempt: true, fg_made: true }, 'Field Goal Good'))).toEqual(['fg']);
        expect(playIcons(play({ downs_turnover: true, start: { yardsToEndzone: 40 } }))).toEqual(['downs']);
        expect(playIcons(play({ downs_turnover: true, start: { yardsToEndzone: 3 } }))).toEqual(['goal-line']);
    });

    test('fumble needs a change of possession unless the pipeline says fumble_lost', () => {
        expect(playIcons(play({ fumble_vec: true }))).toEqual([]);
        expect(playIcons(play({ fumble_vec: true, change_of_pos_team: true }))).toEqual(['fumble']);
        expect(playIcons(play({ fumble_lost: true }))).toEqual(['fumble']);
    });

    test('flags: declined and offsetting replace the plain flag', () => {
        expect(playIcons(play({ penalty_flag: true }))).toEqual(['penalty']);
        expect(playIcons(play({ penalty_flag: true, penalty_declined: true }))).toEqual(['penalty-declined']);
        expect(playIcons(play({ penalty_flag: true, penalty_all_declined: true }))).toEqual(['penalty-declined']);
        expect(playIcons(play({ penalty_flag: true, penalty_offset: true, penalty_declined: true }))).toEqual(['penalty-offset']);
        expect(playIcons(play({ downs_turnover: true, penalty_flag: true }))).toEqual(['downs', 'penalty']);
    });

    test('three-and-out comes from drive context or the annotated flag', () => {
        expect(playIcons(play({ punt: true }, 'Punt'), { threeAndOut: true })).toEqual(['three-out']);
        expect(playIcons(play({ punt: true, three_and_out: true }, 'Punt'))).toEqual(['three-out']);
        const drive = (id: number, n: number, firstDown = false) => [
            ...Array.from({ length: n }, (_, i) => ({ 'drive.id': id, scrimmage_play: true, game_play_number: id * 10 + i, firstD_by_yards: firstDown && i === 0 })),
            { 'drive.id': id, punt: true, scrimmage_play: true, game_play_number: id * 10 + 9 },
        ];
        const plays = [...drive(1, 3), ...drive(2, 5), ...drive(3, 3, true)];
        expect([...threeAndOutPlays(plays as any)]).toEqual([19]);
    });

    test('output order always follows PLAY_ICON_ORDER', () => {
        const all = playIcons(play({ sack: true, int: true, fumble_lost: true, downs_turnover: true, fg_made: true, safety: true, touchdown: true, penalty_flag: true, EPA_explosive: true, start: { yardsToEndzone: 50 } }));
        const idx = all.map((id) => PLAY_ICON_ORDER.indexOf(id));
        expect(idx).toEqual([...idx].sort((a, b) => a - b));
    });
});
