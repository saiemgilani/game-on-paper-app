import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { isScrimmage, periodSplits, situationalRows } from '../src/utils/situational';

const game = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString());
const plays = game.plays as any[];
const situational = game.advBoxScore.situational as any[];
const teams = situational.map((s) => s.pos_team);
const rowsFor = (team: number) => Object.fromEntries(situationalRows(plays, team).map((r) => [r.label, r]));
const count = (v: string) => Number(v.match(/^(\d+)/)![1]);

describe('the full-game split reproduces the precomputed box exactly', () => {
    // This is the whole basis for trusting the period splits, which have no
    // server-side counterpart to check against.
    test.each(situational.map((s) => [s.pos_team] as const))('team %s', (team) => {
        const r = rowsFor(team);
        const box = situational.find((s) => s.pos_team === team)!;
        const teamBox = game.advBoxScore.team.find((t: any) => t.pos_team === team)!;

        expect(count(r['Plays from scrimmage'].value)).toBe(teamBox.scrimmage_plays);
        expect(count(r['Success rate'].value)).toBe(box.EPA_success);
        expect(count(r['Passing'].value)).toBe(teamBox.passes);
        expect(count(r['Rushing'].value)).toBe(teamBox.rushes);
        expect(count(r['Early downs'].value)).toBe(box.early_downs);
        expect(count(r['Late downs'].value)).toBe(box.late_downs);
        expect(count(r['Standard downs'].value)).toBe(box.standard_downs);
        expect(count(r['Passing downs'].value)).toBe(box.passing_downs);
        expect(count(r['Middle 8'].value)).toBe(box.middle_8);
    });
});

describe('scrimmage is the population', () => {
    test('excluding non-scrimmage plays is what makes the counts match', () => {
        // Counting every play instead runs success high by including penalties
        // and special teams -- the mistake this guard exists to prevent.
        for (const team of teams) {
            const all = plays.filter((p) => p.pos_team == team);
            const scrim = all.filter(isScrimmage);
            expect(scrim.length).toBeLessThan(all.length);
            const naive = all.filter((p) => p.EPA_success === true).length;
            const correct = scrim.filter((p) => p.EPA_success === true).length;
            expect(naive).toBeGreaterThan(correct);
            expect(correct).toBe(situational.find((s) => s.pos_team === team)!.EPA_success);
        }
    });
});

describe('periodSplits', () => {
    const splits = periodSplits(plays);

    test('offers the full game, both halves and each quarter played', () => {
        expect(splits.map((s) => s.key)).toEqual(['all', 'h1', 'h2', 'q1', 'q2', 'q3', 'q4']);
    });

    test('the halves partition the game and the quarters partition the halves', () => {
        const at = (k: string) => splits.find((s) => s.key === k)!.plays.length;
        expect(at('h1') + at('h2')).toBe(at('all'));
        expect(at('q1') + at('q2')).toBe(at('h1'));
        expect(at('q3') + at('q4')).toBe(at('h2'));
    });

    test('a quarter that was not played gets no button', () => {
        const firstHalfOnly = plays.filter((p) => Number(p.period) <= 2);
        expect(periodSplits(firstHalfOnly).map((s) => s.key)).toEqual(['all', 'h1', 'q1', 'q2']);
    });

    test('overtime is offered only when it happened', () => {
        expect(splits.some((s) => s.key === 'ot')).toBe(false);
        const withOt = [...plays, { ...plays[0], period: 5 }];
        expect(periodSplits(withOt).some((s) => s.key === 'ot')).toBe(true);
    });

    test('a quarter split sums back to the full game per team', () => {
        for (const team of teams) {
            const whole = count(rowsFor(team)['Plays from scrimmage'].value);
            const byQuarter = ['q1', 'q2', 'q3', 'q4']
                .map((k) => splits.find((s) => s.key === k)!.plays)
                .map((ps) => count(Object.fromEntries(situationalRows(ps, team).map((r) => [r.label, r]))['Plays from scrimmage'].value))
                .reduce((a, b) => a + b, 0);
            expect(byQuarter).toBe(whole);
        }
    });
});
