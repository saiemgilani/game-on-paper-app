// The captures hold what Task 2 measured; a re-capture that changes them is a data change to look at, not to absorb.
import { describe, expect, test } from 'vitest';
import {
    SC, conferences, coverage, fixtureLeagueContext, fixtureShotRows, leadersGames2026, leadersLatest2026, leagueContext, p19, p26,
    placeholderCheck, player2019Games, player2026Games, player2026Seasons, player2026Shots, postseasonGames, scShots, scheduleTeams,
    seasonPlayers, unlinkedPrograms, windowRows,
} from './dashboardFixtures';

const cov = (s: number) => coverage().find((r) => r.season === s)!;
const total = (rows: { kind: string; attempts: number }[]) => rows.filter((r) => r.kind === 'total').map((r) => r.attempts);
const linked = (s: number) => unlinkedPrograms().find((r) => r.season === s)!;
/** D43/D47: a member is a numeric conference row that season with >= 1 game (home or away) in that season's schedule. */
const members = (s: 2019 | 2021 | 2022 | 2026) => {
    const played = new Set(scheduleTeams(s).flatMap((g) => [g.home_id, g.away_id]).filter((t) => t !== null).map(String));
    return conferences(s).filter((r) => /^\d+$/.test(r.team_id) && played.has(r.team_id)).map((r) => Number(r.team_id)).sort((a, b) => a - b);
};
/** Members with no season-player row (no attributed shot) that season. */
const withoutShots = (s: 2019 | 2022 | 2026) => {
    const shot = new Set(seasonPlayers(s).map((r) => r.team_id));
    return members(s).filter((t) => !shot.has(t));
};

describe('the WBB dashboard fixtures', () => {
    test("plan #7's South Carolina rows: 2020-21 and 2021-22, the SQL's context over exactly them, corner-band threes in both", () => {
        const rows = fixtureShotRows();
        expect([...new Set(rows.map((r) => r.season))].sort()).toEqual([2021, 2022]);
        for (const s of [2021, 2022]) {
            expect(total(fixtureLeagueContext().filter((r) => r.season === s)), String(s)).toEqual([rows.filter((r) => r.season === s).length]);
            // R-S1: the 22' 1¾" arc's break is 46.31 tenths, so y <= 46 is the corner band
            expect(rows.some((r) => r.season === s && r.shot_value === 3 && r.y_legacy > 0 && r.y_legacy <= 46), `${s} corner band`).toBe(true);
        }
        expect(new Set(fixtureLeagueContext().map((r) => r.kind))).toEqual(new Set(['hex', 'zone', 'distance_1ft', 'distance_3ft', 'side_3ft', 'total']));
    });
    test('coverage: eight seasons; the league context counts every placed shot, the season rows every attributed one', () => {
        expect(coverage().map((r) => r.season)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        expect(coverage().every((r) => r.meets_floor === true)).toBe(true);
        for (const s of [2019, 2022, 2026] as const) {
            expect(total(leagueContext(s)), String(s)).toEqual([cov(s).placed_shots]);
            expect(seasonPlayers(s).reduce((a, r) => a + r.attempts, 0), String(s)).toBe(cov(s).attributed_shots);
        }
        expect([cov(2019).source_shots, cov(2026).source_shots]).toEqual([236067, 708038]); // the release files (plan #7 measured facts)
        expect(Math.min(...coverage().map((r) => r.placed_share))).toBe(cov(2025).placed_share); // the lowest placed share (0.9442)
        expect(cov(2025).placed_share).toBeGreaterThanOrEqual(0.94);
        expect(cov(2025).placed_share).toBeCloseTo(0.9442, 4);
    });
    test('D25: no college row carries a PIE', () => {
        for (const s of [2019, 2022, 2026] as const) expect(seasonPlayers(s).filter((r) => r.pie !== null), String(s)).toEqual([]);
    });
    test('South Carolina: its attributed team shots equal its season rows; the two page players', () => {
        for (const s of [2019, 2022, 2026] as const) {
            const attributed = scShots(s).filter((r) => r.person_id !== null).length;
            expect(attributed, String(s)).toBe(seasonPlayers(s).filter((r) => r.team_id === SC).reduce((a, r) => a + r.attempts, 0));
        }
        const [a, b] = [p26(), p19()];
        expect(seasonPlayers(2026).filter((r) => r.person_id === a.person_id)).toHaveLength(1); // South Carolina only
        expect(player2026Shots()).toHaveLength(a.attempts);
        expect(player2026Games().every((g) => g.person_id === a.person_id)).toBe(true);
        expect(player2026Games().reduce((n, g) => n + g.attempts, 0)).toBe(a.attempts);
        expect(player2019Games().every((g) => g.person_id === b.person_id)).toBe(true);
        expect(player2019Games().reduce((n, g) => n + g.attempts, 0)).toBe(b.attempts);
    });
    test('no tricode names two different D-I teams in a captured season (college lists key by ESPN id regardless)', () => {
        for (const s of [2019, 2022, 2026] as const) {
            const by = new Map<string, Set<number>>();
            for (const r of seasonPlayers(s)) by.set(r.team_tricode, (by.get(r.team_tricode) ?? new Set()).add(r.team_id));
            expect([...by].filter(([, ids]) => ids.size > 1), String(s)).toEqual([]);
        }
    });
    test('D38 reference: 363 programs in 2026 (the six reclassifiers in), 351 in 2019; numeric text ids, wbb: conferences', () => {
        const c26 = conferences(2026);
        expect(c26).toHaveLength(363);
        expect(c26.every((r) => /^\d+$/.test(r.team_id) && r.conference_id.startsWith('wbb:'))).toBe(true);
        for (const id of [88, 284, 2330, 2511, 2815, 2837]) expect(c26.some((r) => r.team_id === String(id)), String(id)).toBe(true);
        expect(conferences(2019)).toHaveLength(351);
        for (const s of [2019, 2022, 2026] as const) {
            const ids = new Set(conferences(s).map((r) => r.team_id));
            const teams = new Set(seasonPlayers(s).map((r) => String(r.team_id)));
            // every team with shots has a row; R-S5: LIU (112358) has 2018-19 shots in the raw ncaa_shots only, no derived row
            expect([...teams].filter((t) => !ids.has(t)), String(s)).toEqual([]);
        }
        expect(seasonPlayers(2019).filter((r) => r.team_id === 112358)).toEqual([]);
    });
    test('Decision 8: four 2026 programs whose shots the release does not link to ESPN', () => {
        expect(linked(2026).members_without_shots).toEqual([2130, 2385, 2441, 2837]);
        expect(linked(2026).unlinked!.map((u) => [u.name, u.shots])).toEqual([
            ['East Texas A&M', 1703], ['Chicago St.', 1654], ['Mercyhurst', 1585], ['New Haven', 1255],
        ]);
        expect(linked(2019).members_without_shots).toContain(2341);
    });
    test('D26: every 49-day window of every season is under the cap; the captured read is one of them', () => {
        expect(windowRows().map((r) => r.season)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        for (const r of windowRows()) expect(r.max49, String(r.season)).toBeLessThan(50000);
        expect(windowRows().filter((r) => r.season >= 2020).every((r) => r.season_rows >= 50000)).toBe(true); // why a season read is out
        // R-S2: the window is the latest date and the 48 before it (49 dates inclusive)
        const dates = [...new Set(leadersGames2026().map((g) => g.game_date!))].sort();
        const start = new Date(Date.parse(`${leadersLatest2026()[0].game_date}T00:00:00Z`) - 48 * 864e5).toISOString().slice(0, 10);
        expect(dates[0]).toBe(start);
        expect(dates.at(-1)).toBe(leadersLatest2026()[0].game_date);
        expect(dates.length).toBeLessThanOrEqual(49);
        expect(leadersGames2026().length).toBe(windowRows().find((r) => r.season === 2026)!.at_end49);
    });
    test('postseason: none in 2020, some in every other season (D23 wording)', () => {
        for (const r of postseasonGames()) expect(r.games > 0, String(r.season)).toBe(r.season !== 2020);
        expect(postseasonGames().map((r) => r.season)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        expect(postseasonGames().map((r) => r.games)).toEqual([141, 0, 117, 142, 142, 145, 129, 145]);
    });
    test('D29: no placeholder location in stats.ncaa.org WBB shots', () => {
        for (const r of placeholderCheck()) {
            expect([r.top_x, r.top_y], String(r.season)).toEqual([0, 6]);
            expect(r.top_share, String(r.season)).toBeLessThan(0.05);
            expect(r.max_team_game_share, String(r.season)).toBeLessThan(0.5);
        }
        // measured per season 2019-2026: the densest point 0.0147-0.0198 of a season, the busiest team-game 0.1525-0.2405
        expect(placeholderCheck().map((r) => r.season)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
        expect(placeholderCheck().map((r) => r.top_share)).toEqual([0.0147, 0.0167, 0.0176, 0.0177, 0.0182, 0.0192, 0.0198, 0.0195]);
        expect(placeholderCheck().map((r) => r.max_team_game_share)).toEqual([0.1525, 0.2055, 0.1746, 0.2159, 0.2, 0.2405, 0.2241, 0.2022]);
    });
    test('measured facts (Task 2 capture, 2026-10-19): a re-capture that moves one is a data change to look at', () => {
        expect(fixtureShotRows()).toHaveLength(254);
        expect(fixtureLeagueContext()).toHaveLength(273);
        expect([members(2019).length, members(2021).length, members(2022).length, members(2026).length]).toEqual([351, 343, 356, 363]);
        expect(conferences(2021).length - members(2021).length).toBe(12); // the Ivy League's cancelled 2020-21 and others
        expect(conferences(2022)).toHaveLength(356);
        // the four unlinked programs plus New Orleans (2443): placed shots, none attributed to a player
        expect(withoutShots(2026)).toEqual([2130, 2385, 2441, 2443, 2837]);
        expect(withoutShots(2022)).toEqual([85, 161, 399, 2277, 2443, 2459, 2598, 3101]);
        expect(withoutShots(2019)).toEqual([5, 85, 145, 161, 399, 2016, 2277, 2341, 2427, 2443, 2459, 2598]);
        expect([scShots(2019).length, scShots(2022).length, scShots(2026).length]).toEqual([197, 2289, 2599]);
        expect([seasonPlayers(2019).length, seasonPlayers(2022).length, seasonPlayers(2026).length]).toEqual([3791, 4530, 4501]);
        expect(windowRows().map((r) => r.max49)).toEqual([13247, 31832, 28995, 40983, 39895, 38347, 38905, 40799]);
        expect([leadersLatest2026()[0].game_date, leadersGames2026().length]).toEqual(['2026-04-05', 20460]);
        expect([p26().person_id, p26().attempts, player2026Games().length]).toEqual([5239100, 538, 40]);
        expect(player2026Seasons().map((r) => r.season)).toEqual([2025, 2026]);
        expect([p19().person_id, p19().attempts, player2019Games().length]).toEqual([4065759, 41, 3]);
        const qualified = seasonPlayers(2026).filter((r) => r.attempts >= 39);
        const conf = new Map(conferences(2026).map((r) => [r.team_id, r.conference_id]));
        const inConf = (c: string) => qualified.filter((r) => conf.get(String(r.team_id)) === c).length;
        expect(qualified).toHaveLength(3431); // R-S8: All D-I at 39 FGA
        expect([inConf('wbb:acc'), inConf('wbb:big-ten')]).toEqual([167, 167]); // R-S8: the tie, acc by A-Z
    });
});
