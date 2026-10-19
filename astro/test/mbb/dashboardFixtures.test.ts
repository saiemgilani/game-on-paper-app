// The captures hold what Task 2 measured; a re-capture that changes them is a data change to look at, not to absorb.
import { describe, expect, test } from 'vitest';
import {
    TEX, conferences, coverage, fixtureLeagueContext, fixtureShotRows, leadersGames2026, leadersLatest2026, leagueContext, p19, p26,
    placeholderCheck, player2019Games, player2026Games, player2026Shots, postseasonGames, seasonPlayers, texShots, windowRows,
} from './dashboardFixtures';

const cov = (s: number) => coverage().find((r) => r.season === s)!;
const total = (rows: { kind: string; attempts: number }[]) => rows.filter((r) => r.kind === 'total').map((r) => r.attempts);

describe('the MBB dashboard fixtures', () => {
    test("plan #7's fixture rows: 2018-19 and 2025-26, the SQL's context over exactly them", () => {
        const rows = fixtureShotRows();
        expect([...new Set(rows.map((r) => r.season))].sort()).toEqual([2019, 2026]);
        for (const s of [2019, 2026]) expect(total(fixtureLeagueContext().filter((r) => r.season === s))).toEqual([rows.filter((r) => r.season === s).length]);
        expect(new Set(fixtureLeagueContext().map((r) => r.kind))).toEqual(new Set(['hex', 'zone', 'distance_1ft', 'distance_3ft', 'side_3ft', 'total']));
    });
    test('coverage: eight seasons; the league context counts every placed shot, the season rows every attributed one', () => {
        expect(coverage().map((r) => r.season)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        for (const s of [2019, 2026] as const) {
            expect(total(leagueContext(s)), String(s)).toEqual([cov(s).placed_shots]);
            expect(seasonPlayers(s).reduce((a, r) => a + r.attempts, 0), String(s)).toBe(cov(s).attributed_shots);
        }
        expect(cov(2026).source_shots).toBe(740861); // the release's 2026 file (plan #7 measured facts)
        expect(cov(2019).source_shots).toBe(257291);
    });
    test('D25: no college row carries a PIE', () => {
        for (const s of [2019, 2023, 2026] as const) expect(seasonPlayers(s).filter((r) => r.pie !== null), String(s)).toEqual([]);
    });
    test('Texas: its team shots equal its season rows; the two page players', () => {
        for (const s of [2019, 2026] as const) {
            const attributed = texShots(s).filter((r) => r.person_id !== null).length;
            expect(attributed, String(s)).toBe(seasonPlayers(s).filter((r) => r.team_id === TEX).reduce((a, r) => a + r.attempts, 0));
        }
        expect(player2026Shots()).toHaveLength(p26().attempts);
        expect(player2026Games().every((g) => g.person_id === p26().person_id)).toBe(true);
        expect(player2026Games().reduce((a, g) => a + g.attempts, 0)).toBe(p26().attempts);
        expect(player2019Games().every((g) => g.person_id === p19().person_id)).toBe(true);
    });
    test('2023: one tricode names two different D-I teams (why college player lists key by ESPN id)', () => {
        const byTricode = new Map<string, Set<number>>();
        for (const r of seasonPlayers(2023)) byTricode.set(r.team_tricode, (byTricode.get(r.team_tricode) ?? new Set()).add(r.team_id));
        expect([...byTricode].filter(([, ids]) => ids.size > 1).map(([t, ids]) => [t, [...ids].sort((a, b) => a - b)])).toEqual([['SDSU', [21, 2571]]]);
    });
    test('conferences: every 2026 team with shots has a conference row; the text ids are numeric', () => {
        const ids = new Set(conferences(2026).map((r) => r.team_id));
        expect(conferences(2026).every((r) => /^\d+$/.test(r.team_id) && r.conference_id.startsWith('mbb:'))).toBe(true);
        const teams = new Set(seasonPlayers(2026).map((r) => String(r.team_id)));
        expect([...teams].filter((t) => !ids.has(t))).toEqual([]);
    });
    test('D26: every 49-day window of every season is under the cap; the captured read is one of them', () => {
        expect(windowRows().map((r) => r.season)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        for (const r of windowRows()) expect(r.max49, String(r.season)).toBeLessThan(50000);
        expect(windowRows().filter((r) => r.season >= 2020).every((r) => r.season_rows >= 50000)).toBe(true); // why a season read is out
        // R-P4: the window is the latest date and the 48 before it (49 dates inclusive)
        const since = leadersGames2026().map((g) => g.game_date!).sort()[0];
        expect(since >= new Date(Date.parse(`${leadersLatest2026()[0].game_date}T00:00:00Z`) - 48 * 864e5).toISOString().slice(0, 10)).toBe(true);
        expect(leadersGames2026().length).toBe(windowRows().find((r) => r.season === 2026)!.at_end49);
    });
    test('postseason: none in 2020, some in every other season (D23 wording)', () => {
        for (const r of postseasonGames()) expect(r.games > 0, String(r.season)).toBe(r.season !== 2020);
    });
    test('D29: no placeholder location in stats.ncaa.org shots', () => {
        for (const r of placeholderCheck()) {
            expect([r.top_x, r.top_y], String(r.season)).toEqual([0, 6]);
            expect(r.top_share, String(r.season)).toBeLessThan(0.05);
            expect(r.max_team_game_share, String(r.season)).toBeLessThan(0.5);
        }
    });
});
