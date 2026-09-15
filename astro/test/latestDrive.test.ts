import { describe, expect, test } from 'vitest';
import { latestDriveSubtitle, realDriveResult } from '../src/utils/latestDrive';

// Play rows as sportsdataverse-py emits them: a null drive.result becomes "Not provided".
const play = (extra: Record<string, unknown> = {}) => ({
    period: 1,
    clock: { displayValue: '6:21' },
    'drive.team.shortDisplayName': 'Broncos',
    'drive.result': 'Not provided',
    ...extra,
});

describe('realDriveResult', () => {
    test('drops the sportsdataverse-py placeholder and blanks', () => {
        expect(realDriveResult('Not provided')).toBeNull();
        expect(realDriveResult('  not provided ')).toBeNull();
        expect(realDriveResult('')).toBeNull();
        expect(realDriveResult(null)).toBeNull();
        expect(realDriveResult(undefined)).toBeNull();
    });
    test('keeps a real result', () => {
        expect(realDriveResult('Touchdown')).toBe('Touchdown');
    });
});

describe('latestDriveSubtitle', () => {
    test('no plays', () => {
        expect(latestDriveSubtitle({}, null, 'in')).toBe('No plays yet.');
    });

    test('a drive in progress reads its running summary, never "Not provided" (DEN @ KC, 2026-09-14)', () => {
        const drives = {
            current: { id: '9', description: '4 plays, 25 yards, 1:39', team: { shortDisplayName: 'Broncos' } },
            previous: [{ id: '8', displayResult: 'Punt', team: { shortDisplayName: 'Chiefs' } }],
        };
        const text = latestDriveSubtitle(drives, play(), 'in');
        expect(text).toBe('Broncos has the ball. Q1 6:21, drive so far: 4 plays, 25 yards, 1:39.');
        expect(text).not.toContain('Not provided');
    });

    test('ESPN keeps `current` on a drive that already ended: say "Last drive", not "has the ball"', () => {
        const drives = {
            current: { id: '3', description: '7 plays, 68 yards, 4:23', displayResult: 'Touchdown', team: { shortDisplayName: 'Broncos' } },
        };
        expect(latestDriveSubtitle(drives, play({ clock: { displayValue: '3:48' } }), 'in'))
            .toBe('Q1 3:48. Last drive: Broncos, Touchdown (7 plays, 68 yards, 4:23).');
    });

    test('without a drives grouping, the play-row placeholder still never prints', () => {
        expect(latestDriveSubtitle(undefined, play(), 'in')).toBe('Broncos has the ball. Q1 6:21, drive so far: just started.');
    });

    test('final game names the last drive with its result', () => {
        const drives = { previous: [{ id: '20', description: '9 plays, 75 yards, 3:10', displayResult: 'Touchdown', team: { shortDisplayName: 'Texas' } }] };
        expect(latestDriveSubtitle(drives, play({ period: 4 }), 'post')).toBe('Final. Last drive: Texas, Touchdown (9 plays, 75 yards, 3:10).');
    });

    test('final game with no usable result says so plainly', () => {
        expect(latestDriveSubtitle({ previous: [{ id: '1', result: 'Not provided', team: { shortDisplayName: 'Texas' } }] }, play(), 'post'))
            .toBe('Final. Last drive: Texas, no result.');
    });
});
