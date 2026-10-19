import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { WBB_CONFERENCES, WBB_OTHER_DI, WBB_TEAMS, wbbFranchiseOf, wbbSeasonsOf, wbbTeamByEspnId, wbbTeamInSeason } from '../../src/nba/data/wbbTeams';
import { MBB_CONFERENCES } from '../../src/nba/data/mbbTeams';

const fix = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/${n}.json`, import.meta.url)).toString());
const CORE: { count: number; items: { $ref: string }[] } = fix('core_2026');
const TEAMS: { id: number; ab: string; name: string; color: string }[] = fix('teams_2026');
const OTHER: { id: number; ab: string; name: string; color: string; first: number; last: number }[] = fix('other_di');
const CONF: { id: string; label: string }[] = fix('conferences_2026');
const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("the WBB team module is ESPN's core D-I list (owner ruling D34)", () => {
    test('357 teams, exactly the core list, ESPN-id keyed, every row as the fixture says', () => {
        const coreIds = CORE.items.map((i) => Number(i.$ref.match(/teams\/(\d+)/)![1])).sort((a, b) => a - b);
        expect([CORE.count, WBB_TEAMS.length]).toEqual([357, 357]);
        expect(WBB_TEAMS.map((t) => t.team_id)).toEqual(coreIds);
        expect(WBB_TEAMS.map((t) => [t.team_id, t.tricode, t.name, t.color, t.espn_id])).toEqual(TEAMS.map((r) => [r.id, r.ab, r.name, r.color, r.id]));
        for (const t of WBB_TEAMS) expect(t.color, t.name).toMatch(/^#[0-9A-F]{6}$/);
    });
    test('lookup by ESPN id; two core programs the wehoop crosswalk lacks are here', () => {
        expect(wbbTeamByEspnId(41)!.name).toBe('UConn Huskies');
        expect(wbbTeamByEspnId(2385)!.tricode).toBe('MERC'); // Mercyhurst: core list, not in wehoop's 361-row crosswalk
        expect(wbbTeamByEspnId(2698)!.tricode).toBe('WGA');  // West Georgia: same
        expect(wbbTeamByEspnId(111956)).toBeUndefined();     // a non-D-I opponent on the 2024-11-04 board
    });
    test("the conferences are ESPN's women's dropdown minus Division I, in its order, and not the men's list", () => {
        expect(CONF[0]).toEqual({ id: '50', label: 'Division I' });
        expect(WBB_CONFERENCES).toEqual(CONF.slice(1));
        expect(WBB_CONFERENCES).toHaveLength(32);
        expect(WBB_CONFERENCES.find((c) => c.label === 'Summit')!.id).toBe('47');
        expect(MBB_CONFERENCES.find((c) => c.label === 'Summit')!.id).toBe('49');
    });
});

describe('D-I membership by season (plan #6 TeamModule members, D34)', () => {
    test('the 15 other D-I programs are the fixture, each a team only inside its D-I seasons', () => {
        expect(WBB_OTHER_DI.map((o) => [o.team.team_id, o.team.tricode, o.team.name, o.team.color, o.first, o.last]))
            .toEqual(OTHER.map((r) => [r.id, r.ab, r.name, r.color, r.first, r.last]));
        expect(OTHER.map((r) => r.id)).toEqual([3, 42, 88, 284, 2113, 2330, 2341, 2417, 2511, 2542, 2597, 2697, 2736, 2815, 2837]);
    });
    test("the six 2026 programs ESPN's core list omits resolve for 2026 (D34)", () => {
        for (const [id, ab] of [[88, 'USI'], [284, 'STO'], [2330, 'LEM'], [2511, 'QUC'], [2815, 'LIN'], [2837, 'ETAM']] as const) {
            expect(wbbTeamInSeason(id, 2026)?.tricode, ab).toBe(ab);
            expect(wbbTeamByEspnId(id), ab).toBeUndefined();
        }
        expect(wbbTeamInSeason(2330, 2023)).toBeUndefined(); // Le Moyne's first D-I season is 2024
    });
    test('departed and arriving programs', () => {
        expect(wbbTeamInSeason(42, 2023)!.name).toBe('Hartford Hawks'); // R-S11: its last D-I season, 2022-23, as an independent (43)
        expect(wbbTeamInSeason(42, 2024)).toBeUndefined();
        expect(wbbTeamInSeason(2697, 2026)).toBeUndefined(); // West Florida: D-I schedule from 2026-27
        expect(wbbTeamInSeason(2697, 2027)!.tricode).toBe('UWF');
    });
    test('a core team is itself in every season; tricodes resolve to the ESPN id, the core team winning a shared one', () => {
        expect(wbbTeamInSeason(41, 2003)).toBe(wbbTeamByEspnId(41));
        expect(wbbFranchiseOf('CONN')).toBe(41);
        expect(wbbFranchiseOf('HART')).toBe(42);
        expect(wbbFranchiseOf('LIU')).toBe(112358); // Long Island (core) over LIU Brooklyn 2341 (2003-2019)
        expect(wbbFranchiseOf('NOPE')).toBeUndefined();
    });
    test('seasonsOf (R-W2): a core team lists every season, another program its D-I seasons up to 2026, an unknown id none', () => {
        expect(wbbSeasonsOf(41)).toEqual(span(2003, 2026));
        for (const r of OTHER) expect(wbbSeasonsOf(r.id), String(r.id)).toEqual(span(r.first, Math.min(r.last, 2026)));
        expect(wbbSeasonsOf(42)).toEqual(span(2003, 2023));     // Hartford
        expect(wbbSeasonsOf(2511)).toEqual(span(2023, 2026));   // Queens: its 2027 schedule is past WBB_LAST_KNOWN_SEASON
        expect(wbbSeasonsOf(2697)).toEqual([]);                 // West Florida: D-I only from 2027, no listed season yet
        expect(wbbSeasonsOf(111956)).toBeUndefined();
    });
});
