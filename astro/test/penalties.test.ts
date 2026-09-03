import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { penaltiesFor } from '../src/utils/penalties';

const game = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString());
const plays = game.plays as any[];
const teams = game.advBoxScore.team.map((t: any) => t.pos_team);
const flag = (o: Record<string, unknown>) => ({ penalty_flag: true, ...o });

describe('penaltiesFor', () => {
    test('every flagged penalty lands with exactly one team and one unit', () => {
        const all = teams.map((t: number) => penaltiesFor(plays, t));
        const placed = all.reduce((n: number, s: ReturnType<typeof penaltiesFor>) =>
            n + s.offense.length + s.defense.length + s.specialTeams.length, 0);
        expect(placed).toBe(plays.filter((p) => p.penalty_flag === true).length);
    });

    test('the unit follows possession, not the penalty name', () => {
        // penalised team had the ball -> offence, however the infraction is worded
        const off = penaltiesFor([flag({ penalized_team: 5, pos_team: 5, penalty_detail: 'Holding', yds_penalty: '-10' })], 5);
        expect(off.offense).toHaveLength(1);
        expect(off.defense).toHaveLength(0);
        const def = penaltiesFor([flag({ penalized_team: 5, pos_team: 9, penalty_detail: 'Holding', yds_penalty: 10 })], 5);
        expect(def.defense).toHaveLength(1);
    });

    test('a kick outranks possession', () => {
        // a hold on a punt return is special teams even though the flag is on the defence
        const s = penaltiesFor([flag({ penalized_team: 5, pos_team: 9, punt_play: true, penalty_detail: 'Holding', yds_penalty: 10 })], 5);
        expect(s.specialTeams).toHaveLength(1);
        expect(s.defense).toHaveLength(0);
    });

    test('yardage is unsigned, because ESPN signs it by who benefits', () => {
        const s = penaltiesFor([
            flag({ penalized_team: 5, pos_team: 5, yds_penalty: '-5', penalty_detail: 'False Start' }),
            flag({ penalized_team: 5, pos_team: 9, yds_penalty: 15, penalty_detail: 'Pass Interference' }),
        ], 5);
        expect(s.counts.total).toEqual({ n: 2, yards: 20 });
    });

    test('declined and offsetting flags are listed but cost nobody yards', () => {
        const s = penaltiesFor([
            flag({ penalized_team: 5, pos_team: 5, yds_penalty: '-5', penalty_declined: true }),
            flag({ penalized_team: 5, pos_team: 5, yds_penalty: '-5', penalty_offset: true }),
            flag({ penalized_team: 5, pos_team: 5, yds_penalty: '-5' }),
        ], 5);
        expect(s.offense).toHaveLength(3);
        expect(s.counts.total).toEqual({ n: 1, yards: 5 });
        expect(s.declined).toBe(1);
        expect(s.offsetting).toBe(1);
    });

    test('the real game splits the way the play text reads', () => {
        const [away, home] = teams;
        const a = penaltiesFor(plays, away), h = penaltiesFor(plays, home);
        expect(a.counts.total.n + h.counts.total.n).toBe(11);
        // this game is all offence and defence: no flag falls on a kick
        expect(a.specialTeams.length + h.specialTeams.length).toBe(0);
        // false starts are the commonest infraction in it
        expect(a.common.concat(h.common).find((c) => c.detail === 'False Start')?.n).toBeGreaterThan(0);
    });

    test('a team with no penalties reports zeroes rather than throwing', () => {
        const s = penaltiesFor(plays, 999999);
        expect(s.counts.total).toEqual({ n: 0, yards: 0 });
        expect(s.common).toEqual([]);
    });
});
