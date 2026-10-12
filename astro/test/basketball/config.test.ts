// astro/test/basketball/config.test.ts
import { describe, expect, test } from 'vitest';
import { BASKETBALL, basketball, courtFor, pickRegulation, regulationFor, seasonLabelFor, statsSourceOf, type RegulationEra } from '../../src/basketball/config';
import { BASKETBALL_LEAGUES, LEAGUES, PREFIXED_LEAGUES, isBasketball, leagueSource, splitLeague } from '../../src/utils/league';
import { COURT } from '../../src/nba/data/court';
import { NETS_TEAM_ID, teamById } from '../../src/nba/data/teams';
import { NBA_SCOREBOARD_REFRESH } from '../../src/utils/config';

// spec §3.1, as literal eras (config-level helpers take literal inputs; no provider data is parsed here)
const WBB: RegulationEra[] = [{ from: 0, periods: 2, kind: 'half', periodMinutes: 20 }, { from: 2016, periods: 4, kind: 'quarter', periodMinutes: 10 }];
const WNBA: RegulationEra[] = [{ from: 0, periods: 2, kind: 'half', periodMinutes: 20 }, { from: 2006, periods: 4, kind: 'quarter', periodMinutes: 10 }];
const MBB: RegulationEra[] = [{ from: 0, periods: 2, kind: 'half', periodMinutes: 20 }];

describe('basketball league typing', () => {
    test('every basketball league has a LEAGUES entry, a prefix, and is prefixed', () => {
        expect(Object.keys(BASKETBALL).sort()).toEqual([...BASKETBALL_LEAGUES].sort());
        for (const lg of BASKETBALL_LEAGUES) {
            expect(LEAGUES[lg].sport).toBe('basketball');
            expect(LEAGUES[lg].urlPrefix).toBe(`/${lg}`);
            expect(PREFIXED_LEAGUES).toContain(lg);
            expect(BASKETBALL[lg].league).toBe(lg);
        }
        expect(PREFIXED_LEAGUES).toEqual(['nfl', 'nba']); // order is splitLeague's try order; unchanged for the NBA
    });
    test('isBasketball / basketball()', () => {
        expect(isBasketball('nba')).toBe(true);
        for (const lg of ['cfb', 'nfl', undefined, null] as const) expect(isBasketball(lg)).toBe(false);
        expect(basketball('nba')).toBe(BASKETBALL.nba);
        expect(() => basketball('cfb')).toThrow(/not a basketball league/);
        expect(splitLeague('/nba/game/1')).toEqual({ league: 'nba', rest: '/game/1' });
    });
});

describe('regulation: per game from the data, the season rule as fallback', () => {
    test('NBA: four 12-minute quarters whatever the data spelling', () => {
        const q = { periods: 4, kind: 'quarter', periodMinutes: 12 };
        expect(regulationFor('nba', 2026)).toEqual(q);
        expect(regulationFor('nba', 2025, 4.0)).toEqual(q);    // the Data API's float
        expect(regulationFor('nba', 2025, '4')).toEqual(q);
        expect(regulationFor('nba', null, null)).toEqual(q);
    });
    test('halves before a cutoff, quarters after (spec §3.1)', () => {
        expect(pickRegulation(WBB, 2015)).toEqual({ periods: 2, kind: 'half', periodMinutes: 20 });
        expect(pickRegulation(WBB, 2016)).toEqual({ periods: 4, kind: 'quarter', periodMinutes: 10 });
        expect(pickRegulation(WNBA, 2005)).toEqual({ periods: 2, kind: 'half', periodMinutes: 20 });
        expect(pickRegulation(WNBA, 2006)).toEqual({ periods: 4, kind: 'quarter', periodMinutes: 10 });
        expect(pickRegulation(MBB, 2026)).toEqual({ periods: 2, kind: 'half', periodMinutes: 20 });
        expect(pickRegulation(WBB, null)).toEqual({ periods: 4, kind: 'quarter', periodMinutes: 10 }); // no season: the latest era
    });
    test("the game's own regulation wins over the season rule; junk does not", () => {
        expect(pickRegulation(WBB, 2014, 4)).toEqual({ periods: 4, kind: 'quarter', periodMinutes: 10 });
        expect(pickRegulation(WBB, 2020, 2)).toEqual({ periods: 2, kind: 'half', periodMinutes: 20 });
        for (const junk of [3, 0, '', 'x', NaN, undefined, null]) expect(pickRegulation(WBB, 2015, junk)).toEqual({ periods: 2, kind: 'half', periodMinutes: 20 });
        expect(pickRegulation(MBB, 2026, 4)).toEqual({ periods: 4, kind: 'quarter', periodMinutes: 10 }); // no quarter era: 40 regulation minutes over 4
    });
});

describe('the nba entry', () => {
    const nba = BASKETBALL.nba;
    test('identity and sources', () => {
        expect(nba.gamesSource).toEqual({ apiBase: 'https://data.sportsdataverse.org/v1/nba', schema: 'nba', namespace: 'nba-games' });
        expect(statsSourceOf('nba')).toEqual(leagueSource('nba'));
        expect(nba.statsLeagueId).toBe('00');
        expect(nba.regularGameIdPrefix).toBe('002');
        expect(nba.statsSourceLabel).toBe('stats.nba.com');
        expect(nba.firstScoreboardDay).toBe('1997-10-01');
        expect(nba.scoreboardTimeZone).toBe('America/New_York');
        expect(nba.scoreboardRefresh).toBe(NBA_SCOREBOARD_REFRESH);
        expect(nba.overtimeMinutes).toBe(5);
        expect(nba.landing).toBe('featured-team');
        expect(nba.shotDashboards).toBe('stats-api');
    });
    test('featured team: the Nets, both ids, both tricodes', () => {
        expect(nba.featuredTeam!.statsTeamId).toBe(NETS_TEAM_ID);
        expect(teamById(NETS_TEAM_ID)!.espn_id).toBe(nba.featuredTeam!.espnTeamId);
        expect(nba.featuredTeam!.tricode(2012)).toBe('NJN');
        expect(nba.featuredTeam!.tricode(2013)).toBe('BKN');
    });
    test('header menu: the featured entry exists exactly when a featured team does', () => {
        for (const cfg of Object.values(BASKETBALL)) {
            const home = cfg.headerMenu.filter((m) => m.path === '/');
            expect(home.length).toBe(cfg.featuredTeam ? 1 : 0);
            if (cfg.featuredTeam) expect(home[0].label).toBe(cfg.featuredTeam.menuLabel);
        }
        expect(nba.headerMenu.map((m) => `${m.label} ${m.path}`)).toEqual(['Scoreboard /scoreboard', 'Nets /', 'Players /players', 'Teams /teams', 'Scatter /scatter', 'Leaders /leaders']);
    });
    test('court and season label', () => {
        expect(courtFor('nba', 2026)).toBe(COURT);
        expect(courtFor('nba', 1990)).toBe(COURT); // before the first era: the first era
        expect(seasonLabelFor('nba', 2026)).toBe('2025-26');
        expect(nba.teams.all.length).toBe(30);
        expect(nba.teams.byEspnId(17)!.team_id).toBe(NETS_TEAM_ID);
    });
});
