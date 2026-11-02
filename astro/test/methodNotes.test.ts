import { describe, expect, test } from 'vitest';
import { METHOD_NOTES, seasonNote } from '../src/utils/methodNotes';
import { SDV_TEAM_METRIC_HOVER_TEXT, TEAM_METRIC_HOVER_TEXT } from '../src/utils/constants';

describe('METHOD_NOTES', () => {
    test('every note is a sentence in the house style: a period, no dashes or dot separators', () => {
        for (const [k, v] of Object.entries(METHOD_NOTES)) {
            expect(v.endsWith('.'), k).toBe(true);
            for (const bad of [' - ', ' — ', '·', '•']) expect(v, k).not.toContain(bad);
        }
    });

    test('season notes name the population per league', () => {
        expect(seasonNote('cfb')).toContain('FBS vs FBS');
        expect(seasonNote(undefined)).toBe(seasonNote('cfb'));
        expect(seasonNote('nfl')).toContain('regular season');
    });

    test('the game note says garbage time is included; the adjusted note has no typo', () => {
        expect(METHOD_NOTES.game).toContain('garbage time included');
        expect(METHOD_NOTES.adjusted).not.toContain('advantange');
    });

    test('the leaderboard and team-page hovers read the one adjusted sentence', () => {
        for (const c of ['differential', 'offensive', 'defensive']) expect(TEAM_METRIC_HOVER_TEXT[c]['overall.adjEpaPerPlay']).toBe(METHOD_NOTES.adjusted);
        expect(SDV_TEAM_METRIC_HOVER_TEXT.differential.net_adj_epa).toBe(METHOD_NOTES.adjusted);
        expect(SDV_TEAM_METRIC_HOVER_TEXT.offensive.adj_off_epa).toBe(METHOD_NOTES.adjusted);
        expect(SDV_TEAM_METRIC_HOVER_TEXT.defensive.adj_def_epa).toBe(METHOD_NOTES.adjusted);
    });
});
