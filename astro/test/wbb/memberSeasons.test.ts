// astro/test/wbb/memberSeasons.test.ts
// R-S4 (plan #9's R-P11 member pair, on the women): the member-seasons table is generated from the warehouse by withSeasonMembers'
// rule (D43/D47, R7); it re-derives from the committed captures, every member resolves through the team module in each of its
// seasons (R-S11: Hartford's 2022-23), and the season rollover moves currentMembers, the table and WBB_LAST_KNOWN_SEASON together.
import { describe, expect, test } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { memberSeasonsOf, withSeasonMembers } from '../../src/basketball/dashboards';
import { WBB_MEMBER_SEASONS, WBB_MEMBER_SEASONS_THROUGH } from '../../src/nba/data/wbbMemberSeasons';
import { wbbTeamInSeason } from '../../src/nba/data/wbbTeams';
import { WBB_LAST_KNOWN_SEASON } from '../../src/nba/seasonRange';
import { conferences, scheduleTeams } from './dashboardFixtures';

const membersOf = (s: number) => [...WBB_MEMBER_SEASONS].filter(([, ss]) => ss.includes(s)).map(([id]) => id).sort((a, b) => a - b);
const ALL = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

describe('the WBB member-seasons table (R-S4)', () => {
    test('2019, 2021 and 2026 re-derive from the committed captures by the same rule', () => {
        for (const s of [2019, 2021, 2026] as const) {
            const played = new Set(scheduleTeams(s).flatMap((g) => [g.home_id, g.away_id]).filter((x) => x != null).map(Number));
            const rule = [...new Set(conferences(s).filter((r) => /^\d+$/.test(r.team_id)).map((r) => Number(r.team_id)))].filter((id) => played.has(id)).sort((a, b) => a - b);
            expect(membersOf(s), String(s)).toEqual(rule);
            expect(withSeasonMembers([], conferences(s), scheduleTeams(s), s, 'wbb').map((t) => t.team_id).sort((a, b) => a - b), String(s)).toEqual(rule);
        }
    });
    test('members per season as measured (pre-flight); every member resolves through the team module in each of its seasons', () => {
        expect(ALL.map((s) => membersOf(s).length)).toEqual([351, 351, 343, 356, 361, 360, 362, 363]);
        for (const [id, ss] of WBB_MEMBER_SEASONS) for (const s of ss) expect(wbbTeamInSeason(id, s), `${id} ${s}`).toBeDefined();
        expect(WBB_MEMBER_SEASONS.get(42)).toEqual([2019, 2020, 2021, 2022, 2023]); // R-S11: Hartford's last D-I season, as an independent
        // R-S13: New Orleans 2443 is a member every season although no season-player row carries it
        expect(WBB_MEMBER_SEASONS.get(2443)).toEqual(ALL);
    });
    test('the season rollover moves together: currentMembers, the member table and WBB_LAST_KNOWN_SEASON agree', () => {
        const w = BASKETBALL.wbb;
        expect([w.currentMembers!.season, w.memberSeasons!.through, WBB_MEMBER_SEASONS_THROUGH]).toEqual([WBB_LAST_KNOWN_SEASON, WBB_LAST_KNOWN_SEASON, WBB_LAST_KNOWN_SEASON]);
        expect(w.memberSeasons!.seasons).toBe(WBB_MEMBER_SEASONS);
        expect([...w.currentMembers!.ids].sort((a, b) => a - b)).toEqual(membersOf(WBB_LAST_KNOWN_SEASON));
    });
    test('the season pickers offer only member seasons (memberSeasonsOf)', () => {
        expect(memberSeasonsOf('wbb', 42, 2023, ALL)).toEqual([2019, 2020, 2021, 2022, 2023]); // Hartford
        expect(memberSeasonsOf('wbb', 2330, 2026, ALL)).toEqual([2024, 2025, 2026]);           // Le Moyne: D-I from 2023-24
        expect(memberSeasonsOf('wbb', 2341, 2019, ALL)).toEqual([2019]);                       // LIU Brooklyn: 2018-19 only
    });
});
