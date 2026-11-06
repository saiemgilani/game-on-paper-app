import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { MBB_CONFERENCES, MBB_OTHER_DI, MBB_TEAMS, mbbFranchiseOf, mbbSeasonsOf, mbbTeamByEspnId, mbbTeamInSeason } from '../../src/nba/data/mbbTeams';

const fix = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/mbb/${n}.json`, import.meta.url)).toString());
const XW: { espn_team_id: number; espn_abbreviation: string; espn_display_name: string; color: string }[] = fix('teams_2026');
const OTHER: { id: number; ab: string; name: string; first: number; last: number; color: string }[] = fix('other_di');
const CONF: { id: string; label: string }[] = fix('conferences_2026');
const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("the MBB team module is ESPN's core D-I list for 2026 with ESPN's names and colours (D34)", () => {
    test('366 teams, ESPN-id keyed, every row as the fixture says', () => {
        expect(MBB_TEAMS).toHaveLength(366);
        expect(MBB_TEAMS.map((t) => [t.team_id, t.tricode, t.name, t.color, t.espn_id]))
            .toEqual(XW.map((r) => [r.espn_team_id, r.espn_abbreviation, r.espn_display_name, r.color, r.espn_team_id]));
        for (const t of MBB_TEAMS) expect(t.color, t.name).toMatch(/^#[0-9A-F]{6}$/);
    });
    test('the programs hoopR\'s crosswalk and the site list omit are teams; the D-II team the site lists is not (D34)', () => {
        // Southern Indiana, Queens, Saint Francis (PA), Lindenwood: full D-I conference schedules in 2026; Hartford: in ESPN's core list
        for (const id of [88, 2511, 2598, 2815, 42]) expect(mbbTeamByEspnId(id), String(id)).toBeDefined();
        expect(mbbTeamByEspnId(2815)!.tricode).toBe('LIN');
        expect(mbbTeamByEspnId(2697)).toBeUndefined(); // West Florida, D-II
    });
    test('lookup by ESPN id; a non-D-I opponent is not a team', () => {
        expect(mbbTeamByEspnId(150)!.name).toBe('Duke Blue Devils');
        expect(mbbTeamByEspnId(2476)).toBeUndefined(); // Oglethorpe, a non-D-I opponent on the 2024-11-04 board
    });
    test("the conferences are ESPN's dropdown minus Division I, in its order", () => {
        expect(CONF[0]).toEqual({ id: '50', label: 'Division I' });
        expect(MBB_CONFERENCES).toEqual(CONF.slice(1));
        expect(MBB_CONFERENCES).toHaveLength(32);
    });
});

describe('D-I membership by season (plan #6 TeamModule members)', () => {
    test('the departed D-I programs are the fixture, each a team only inside its D-I seasons', () => {
        expect(MBB_OTHER_DI.map((o) => [o.team.team_id, o.team.tricode, o.team.name, o.team.color, o.first, o.last]))
            .toEqual(OTHER.map((r) => [r.id, r.ab, r.name, r.color, r.first, r.last]));
        expect(OTHER.map((r) => r.id)).toEqual([2113, 2542, 2597]);
        // hoopR-mbb-data's 2023 schedule (its last D-I season) spells St. Francis Brooklyn SFBK, as ESPN's team endpoint does
        expect(mbbTeamInSeason(2597, 2023)!.tricode).toBe('SFBK');
        expect(mbbTeamInSeason(2597, 2024)).toBeUndefined();             // left D-I after 2023
        expect(mbbTeamByEspnId(2597)).toBeUndefined();                    // not one of the 366
    });
    test('one of the 366 is itself in every season (who played D-I that season is plan #9\'s withSeasonMembers); tricodes resolve', () => {
        expect(mbbTeamInSeason(150, 2003)).toBe(mbbTeamByEspnId(150));
        expect(mbbTeamInSeason(42, 2026)).toBe(mbbTeamByEspnId(42));     // the module answers "who is 42"; D43/D47 drop Hartford from 2026 pages
        expect(mbbFranchiseOf('DUKE')).toBe(150);
        expect(mbbFranchiseOf('HART')).toBe(42);
        expect(mbbFranchiseOf('SFBK')).toBe(2597);
        expect(mbbFranchiseOf('NOPE')).toBeUndefined();
    });
    test('seasonsOf (R3): the 366 list every season, a departed program its measured D-I seasons, an unknown id none', () => {
        expect(mbbSeasonsOf(150)).toEqual(span(2003, 2026));
        expect(mbbSeasonsOf(42)).toEqual(span(2003, 2026));
        for (const r of OTHER) expect(mbbSeasonsOf(r.id), String(r.id)).toEqual(span(r.first, r.last));
        expect(mbbSeasonsOf(2113)).toEqual([2008, 2009, 2010, 2011]); // Centenary
        expect(mbbSeasonsOf(2476)).toBeUndefined();
    });
});
