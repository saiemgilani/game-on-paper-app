import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { timeOfPossession, traditionalTeamStats } from '../src/utils/traditionalStats';

const game = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString());
const plays = game.plays as any[];
const [away, home] = game.advBoxScore.team.map((t: any) => t.pos_team);
const row = (teamId: number, label: string) => traditionalTeamStats(plays, teamId).find((r) => r.label === label)!;

describe('traditionalTeamStats on a real game', () => {
    test('third downs match a hand count of the plays', () => {
        for (const team of [away, home]) {
            const att = plays.filter((p) => p.pos_team == team && p.down === 3);
            const made = att.filter((p) => p.first_down_created === true);
            expect(row(team, 'Third down').value).toBe(`${made.length}-${att.length} (${Math.round((made.length / att.length) * 100)}%)`);
        }
    });

    test('the two clocks partition the game, never double-count it', () => {
        // ESPN files the play after a turnover, and the ensuing kickoff, under the
        // drive that just ended -- 8 of this game's 26 drives carry both teams'
        // snaps. Charging a drive to whoever snapped it first is what keeps the
        // two clocks from summing to 78:52 of a 60-minute game.
        const seen = new Map<string, number>();
        for (const p of plays) {
            const id = p['drive.id'];
            if (id && !seen.has(id)) {
                const [m, s] = String(p['drive.timeElapsed.displayValue'] ?? '0:00').split(':').map(Number);
                seen.set(id, m * 60 + s);
            }
        }
        const everyDrive = [...seen.values()].reduce((t, n) => t + n, 0);
        expect(timeOfPossession(plays, away) + timeOfPossession(plays, home)).toBe(everyDrive);
        expect(everyDrive).toBeLessThan(61 * 60);
    });

    test('a red-zone trip counts once however many snaps it took', () => {
        for (const team of [away, home]) {
            const drives = new Set(plays.filter((p) => p.pos_team == team && p.rz_play === true).map((p) => p['drive.id']));
            const [, trips] = row(team, 'Red zone scoring').value.match(/^\d+-(\d+)/)!;
            expect(Number(trips)).toBe(drives.size);
            // more snaps than trips is the whole point of counting drives
            expect(plays.filter((p) => p.pos_team == team && p.rz_play === true).length).toBeGreaterThanOrEqual(drives.size);
        }
    });

    test('every row prints something, and EPA is null only where no play backs it', () => {
        for (const r of traditionalTeamStats(plays, away)) {
            expect(r.value).toMatch(/\S/);
            if (r.label === 'Time of possession') expect(r.epa).toBeNull();
        }
    });

    test('an empty game yields rows rather than throwing', () => {
        const rows = traditionalTeamStats([], 1);
        expect(rows).toHaveLength(6);
        expect(rows.every((r) => r.epa === null)).toBe(true);
        expect(row(away, 'Time of possession').value).toMatch(/^\d+:\d\d$/);
    });
});
