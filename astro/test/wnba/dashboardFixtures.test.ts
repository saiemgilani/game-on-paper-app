// The captures are what Task 2 measured on the release; a re-capture that changes them is a data change to look at, not to absorb.
import { describe, expect, test } from 'vitest';
import { SEA, leagueContext, leagueShots2003, p03, p26, player2003Games, player2026Shots, playerGames2026, seaShots, seasonPlayers } from './dashboardFixtures';

describe('the WNBA dashboard fixtures', () => {
    test('shot counts: 2003 league-wide, Seattle by era, regular season only', () => {
        const all = leagueShots2003();
        expect(all).toHaveLength(28436);
        expect(all.every((s) => s.game_id.startsWith('102'))).toBe(true);
        expect(all.filter((s) => s.team_id === SEA)).toHaveLength(2045);
        expect(seaShots(2008)).toHaveLength(2112);
        expect(seaShots(2026)).toHaveLength(3061);
    });
    test('season rows sum to the season attempts; the league context total agrees', () => {
        const want = { 2003: 28436, 2008: 31006, 2025: 38535, 2026: 45296 } as const;
        for (const s of [2003, 2008, 2025, 2026] as const) expect(seasonPlayers(s).reduce((a, r) => a + r.attempts, 0), String(s)).toBe(want[s]);
        for (const s of [2003, 2026] as const) expect(leagueContext(s).filter((r) => r.kind === 'total').map((r) => r.attempts)).toEqual([want[s]]);
    });
    test('D29: 2003 parks 5,677 shots at the hoop centre (0, 0); the league total counts them and says so', () => {
        const ph = leagueShots2003().filter((s) => s.x_legacy === 0 && s.y_legacy === 0);
        expect(ph).toHaveLength(5677);
        expect(ph.filter((s) => s.team_id === SEA)).toHaveLength(424);
        const total = leagueContext(2003).find((r) => r.kind === 'total')!;
        expect([total.attempts, total.placeholder_shots]).toEqual([28436, 5677]); // counted in the total (R3)
    });
    test('2025 carries one real team_id 0 row (an empty-tricode shot); no other season does', () => {
        expect(seasonPlayers(2025).filter((r) => r.team_id === 0)).toHaveLength(1);
        for (const s of [2003, 2008, 2026] as const) expect(seasonPlayers(s).some((r) => r.team_id === 0)).toBe(false);
    });
    test('D19: every player with a season-stats row has USG% and PIE, every season', () => {
        for (const s of [2003, 2008, 2025, 2026] as const) {
            const stats = seasonPlayers(s).filter((r) => r.has_stats);
            expect(stats.length, String(s)).toBeGreaterThan(0);
            expect(stats.filter((r) => r.usg_pct === null || r.pie === null), String(s)).toEqual([]);
        }
    });
    test('the two page players', () => {
        // read each player once: p26()/p03() re-read the fixture, so calling them per row times out
        const [a, b] = [p26(), p03()];
        expect(a.person_id).toBe(1643428);
        expect(player2026Shots()).toHaveLength(a.attempts);
        expect(playerGames2026().some((g) => g.person_id === a.person_id)).toBe(true);
        expect(b.headshot_href).toBeNull();
        expect(player2003Games().every((g) => g.person_id === b.person_id)).toBe(true);
        expect(leagueShots2003().filter((s) => s.person_id === b.person_id)).toHaveLength(b.attempts);
    });
});
