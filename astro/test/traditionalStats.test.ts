import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { timeOfPossession, traditionalTeamStats } from '../src/utils/traditionalStats';

const game = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString());
const plays = game.plays as any[];
// The same drives grouping GamePage builds and DrivesTable already consumes.
const drives = (game.drives.current ? (game.drives.previous ?? []).concat([game.drives.current]) : (game.drives.previous ?? [])) as any[];
const [away, home] = game.advBoxScore.team.map((t: any) => t.pos_team);
const row = (teamId: number, label: string) => traditionalTeamStats(plays, teamId, drives).find((r) => r.label === label)!;

describe('traditionalTeamStats on a real game', () => {
    test('third downs match a hand count of the plays', () => {
        for (const team of [away, home]) {
            const att = plays.filter((p) => p.pos_team == team && p.down === 3);
            const made = att.filter((p) => p.first_down_created === true);
            expect(row(team, 'Third down').value).toBe(`${made.length}-${att.length} (${Math.round((made.length / att.length) * 100)}%)`);
        }
    });

    test('the two clocks partition the game, never double-count it', () => {
        // Ownership comes from drive.team, so this is a partition by construction.
        // It is worth pinning because a drive.id is NOT exclusive to one offense --
        // ESPN files the play after a turnover, and the ensuing kickoff, under the
        // drive that just ended (drive 1 reports 12 offensivePlays and carries 14).
        // Grouping plays by drive id and filtering by pos_team charges 8 of this
        // game's 26 drives to both teams, for 78:52 of a 60-minute game.
        const everyDrive = drives.reduce((t, d) => {
            const [m, s] = String(d.timeElapsed?.displayValue ?? '0:00').split(':').map(Number);
            return t + m * 60 + s;
        }, 0);
        expect(timeOfPossession(drives, away) + timeOfPossession(drives, home)).toBe(everyDrive);
        expect(everyDrive).toBeLessThan(61 * 60);
    });

    test('possession is read off drive.team, not inferred from the plays', () => {
        for (const team of [away, home]) {
            const mine = drives.filter((d) => String(d.team?.id) === String(team));
            expect(mine.length).toBeGreaterThan(0);
            const expected = mine.reduce((t, d) => {
                const [m, s] = String(d.timeElapsed?.displayValue ?? '0:00').split(':').map(Number);
                return t + m * 60 + s;
            }, 0);
            expect(timeOfPossession(drives, team)).toBe(expected);
        }
    });

    test('a red-zone trip counts once however many snaps it took, and scores come from drive.isScore', () => {
        for (const team of [away, home]) {
            const rzIds = new Set(plays.filter((p) => p.pos_team == team && p.rz_play === true).map((p) => p['drive.id']));
            const mine = drives.filter((d) => String(d.team?.id) === String(team) && rzIds.has(d.id));
            const [, scores, trips] = row(team, 'Red zone scoring').value.match(/^(\d+)-(\d+)/)!;
            expect(Number(trips)).toBe(mine.length);
            expect(Number(scores)).toBe(mine.filter((d) => d.isScore === true).length);
            expect(Number(scores)).toBeLessThanOrEqual(Number(trips));
            // more snaps than trips is the whole point of counting drives
            expect(plays.filter((p) => p.pos_team == team && p.rz_play === true).length).toBeGreaterThanOrEqual(mine.length);
        }
    });

    test('every row prints something, and EPA is null only where no play backs it', () => {
        for (const r of traditionalTeamStats(plays, away, drives)) {
            expect(r.value).toMatch(/\S/);
            if (r.label === 'Time of possession') expect(r.epa).toBeNull();
        }
    });

    test('an empty game yields rows rather than throwing', () => {
        const rows = traditionalTeamStats([], 1, []);
        expect(rows).toHaveLength(6);
        expect(rows.every((r) => r.epa === null)).toBe(true);
        expect(row(away, 'Time of possession').value).toMatch(/^\d+:\d\d$/);
    });
});
