// D48 (resolution R8, rulings R-P2/R-P3): teamHrefFromEspn(team, league, season?). A league without a membership table (NBA,
// WNBA): the shipped rule, unchanged. College: the season's page for a member of that season (departed programs resolve
// through inSeason); a non-member is plain text (its page is a 404); before the shot dashboards' first season (2019) a
// current member links its current page and anyone else is plain text. Season omitted = the current season.
import { describe, expect, test } from 'vitest';
import { teamHrefFromEspn } from '../../src/nba/links';

describe('season-aware team links (D48, R8)', () => {
    test("season omitted, or the NBA with a season: today's rule", () => {
        expect(teamHrefFromEspn({ id: '150' }, 'mbb')).toBe('/mbb/team/150');
        expect(teamHrefFromEspn({ id: '17' }, 'nba')).toBe('/nba/team/1610612751');
        expect(teamHrefFromEspn({ id: '17' }, 'nba', 2015)).toBe('/nba/team/1610612751'); // no currentMembers: the season is ignored
        expect(teamHrefFromEspn({ id: '999' }, 'nba', 2026)).toBeNull();
    });
    test('college, the current season: members link with no query; Hartford (no 2026 conference row) is plain text', () => {
        expect(teamHrefFromEspn({ id: '150' }, 'mbb', 2026)).toBe('/mbb/team/150');
        expect(teamHrefFromEspn({ id: '42' }, 'mbb', 2026)).toBeNull();
        expect(teamHrefFromEspn({ id: '42' }, 'mbb')).toBeNull();       // season omitted = the current season
        expect(teamHrefFromEspn({ id: '42' }, 'mbb', null)).toBeNull(); // a game whose header has no season
    });
    test("college, a past season: that season's page; a departed program resolves through inSeason", () => {
        expect(teamHrefFromEspn({ id: '150' }, 'mbb', 2019)).toBe('/mbb/team/150?season=2019');
        expect(teamHrefFromEspn({ id: '42' }, 'mbb', 2019)).toBe('/mbb/team/42?season=2019');      // Hartford, D-I in 2018-19
        expect(teamHrefFromEspn({ id: '2597' }, 'mbb', 2023)).toBe('/mbb/team/2597?season=2023'); // St. Francis Brooklyn (MBB_OTHER_DI)
        expect(teamHrefFromEspn({ id: '2597' }, 'mbb', 2024)).toBeNull();
        expect(teamHrefFromEspn({ id: '2476' }, 'mbb', 2019)).toBeNull();                          // Oglethorpe, never D-I
    });
    test('college, a past season the team was not a member (R-P11 table): plain text, its page is a 404', () => {
        expect(teamHrefFromEspn({ id: '88' }, 'mbb', 2022)).toBeNull();                          // Southern Indiana, member from 2023
        expect(teamHrefFromEspn({ id: '88' }, 'mbb', 2023)).toBe('/mbb/team/88?season=2023');
    });
    test('R-P3: before 2019 a current member links its current page (no ?season=), anyone else is plain text', () => {
        expect(teamHrefFromEspn({ id: '150' }, 'mbb', 2015)).toBe('/mbb/team/150');
        expect(teamHrefFromEspn({ id: '150' }, 'mbb', 2018)).toBe('/mbb/team/150');
        expect(teamHrefFromEspn({ id: '42' }, 'mbb', 2015)).toBeNull();   // Hartford: D-I then, not a 2026 member
        expect(teamHrefFromEspn({ id: '2597' }, 'mbb', 2010)).toBeNull(); // St. Francis Brooklyn, departed
    });
});
