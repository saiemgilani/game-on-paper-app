// test/nba/seasonGames.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { seasonPlayerGamesFromRows } from '../../src/nba/adapters';
import type { PlayerGameRow } from '../../src/resources/nbaShots';
import { seasonPlayerRows } from './rows';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const byPlayer = read('player_games') as Record<string, any[]>;
/** The fixture's per-player games as shot_player_games rows for the season. */
function gameRows(): PlayerGameRow[] {
    return Object.entries(byPlayer).flatMap(([pid, games]) => games.map((g) => ({
        season: 2026, person_id: Number(pid), game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
        fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
    })));
}

describe('seasonPlayerGamesFromRows', () => {
    test('one PlayerGames per player, games in date order, named from the player rows', () => {
        const out = seasonPlayerGamesFromRows(gameRows(), seasonPlayerRows());
        expect(out.length).toBe(Object.keys(byPlayer).length);
        for (const p of out) {
            const dates = p.games.map((g) => g.date);
            expect(dates).toEqual([...dates].sort());
            expect(p.games.length).toBe(byPlayer[String(p.person_id)].length);
        }
        const named = out.find((p) => seasonPlayerRows().some((r) => r.person_id === p.person_id))!;
        expect(named.name).toBe(seasonPlayerRows().find((r) => r.person_id === named.person_id)!.player_name);
    });
    test('team is the latest game\'s team, not the primary row\'s', () => {
        const rows = gameRows();
        const pid = rows[0].person_id;
        const mine = rows.filter((r) => r.person_id === pid).sort((a, b) => a.game_date!.localeCompare(b.game_date!));
        const last = mine[mine.length - 1];
        last.team_id = 1610612738; last.team_tricode = 'BOS';
        const p = seasonPlayerGamesFromRows(rows, seasonPlayerRows()).find((x) => x.person_id === pid)!;
        expect(p.team_id).toBe(1610612738);
        expect(p.team).toBe('BOS');
    });
    test('a player with a game the logs cannot place is left out, the others stay', () => {
        const rows = gameRows();
        const pid = rows[0].person_id;
        rows.find((r) => r.person_id === pid)!.game_date = null;
        const out = seasonPlayerGamesFromRows(rows, seasonPlayerRows());
        expect(out.some((p) => p.person_id === pid)).toBe(false);
        expect(out.length).toBe(Object.keys(byPlayer).length - 1);
    });
    test('a person missing from the player rows is still listed, named by id', () => {
        const rows = gameRows().map((r) => ({ ...r, person_id: 999 }));
        const [p] = seasonPlayerGamesFromRows(rows, []);
        expect(p.person_id).toBe(999);
        expect(p.name).toBe('999');
    });
    test('no rows: no players', () => {
        expect(seasonPlayerGamesFromRows([], seasonPlayerRows())).toEqual([]);
    });
});
