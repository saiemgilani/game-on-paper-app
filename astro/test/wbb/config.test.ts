import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor, hasTeamPages, islandLeagueProps, regulationFor, seasonLabelFor, statsSourceOf } from '../../src/basketball/config';
import { COURT, NCAA_ARC_NEW, NCAA_CORNER_X, NCAA_COURTS, NCAA_W_COURTS, threeBreakY } from '../../src/nba/data/court';
import { WBB_CONFERENCES, WBB_TEAMS, wbbFranchiseOf, wbbSeasonsOf, wbbTeamInSeason } from '../../src/nba/data/wbbTeams';
import { gameHref, teamHrefFromEspn } from '../../src/nba/links';
import { wbbGamesInScope, wbbLeaderBars, wbbSeasonGames } from '../../src/nba/seasonRange';
import { darkLogoCss, parseDateParam } from '../../src/nba/scoreboard';
import { LEAGUES, PREFIXED_LEAGUES, splitLeague, teamLogoUrl } from '../../src/utils/league';

const HALF = { periods: 2, kind: 'half', periodMinutes: 20 };
const QUARTER = { periods: 4, kind: 'quarter', periodMinutes: 10 };
const ft = (f: number, i = 0) => (f + i / 12) * 10; // feet + inches -> legacy tenths
const fix = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/${n}.json`, import.meta.url)).toString());
const GAMES: { season: number; median: number }[] = fix('season_games');
const BARS: { season: number; fga: number; fg3a: number }[] = fix('leader_bars');

describe('the wbb league entry', () => {
    test('identity and prefix', () => {
        expect(PREFIXED_LEAGUES).toEqual(['nfl', 'nba', 'wnba', 'mbb', 'wbb']);
        expect(splitLeague('/wbb/game/401805076')).toEqual({ league: 'wbb', rest: '/game/401805076' });
        const l = LEAGUES.wbb;
        expect([l.sport, l.name, l.shortName, l.urlPrefix, l.espnPath, l.espnCoreLeague, l.logoLeague, l.scoreboardCacheKey, l.sdvApiBase, l.sdvSchema, l.teamCount, l.pool, l.defaultGroup, l.scoreboardQuery])
            .toEqual(['basketball', "Women's College Basketball", 'WBB', '/wbb', 'womens-college-basketball', 'womens-college-basketball', 'ncaa', 'scoreboard:wbb', 'https://data.sportsdataverse.org/v1/wbb', 'wbb', 363, 'D-I', null, '']); // D38: 357 core + 6 reclassifiers
        expect([l.seasons[0], l.seasons.at(-1)]).toEqual([2003, 2026]);
    });
    test('sources: ESPN-keyed games and the wbb schema; no stats ids', () => {
        const w = BASKETBALL.wbb;
        expect(w.gamesSource).toEqual({ apiBase: 'https://data.sportsdataverse.org/v1/wbb', schema: 'wbb', namespace: 'wbb-games' });
        expect(statsSourceOf('wbb')).toEqual({ apiBase: 'https://data.sportsdataverse.org/v1/wbb', schema: 'wbb', namespace: 'wbb' });
        expect([w.statsLeagueId, w.regularGameIdPrefix, w.statsSourceLabel, w.shotDashboards]).toEqual([null, null, 'stats.ncaa.org', 'ncaa']);
        expect(w.teams.all).toBe(WBB_TEAMS);
        expect([w.teams.inSeason, w.teams.franchiseOf, w.teams.seasonsOf]).toEqual([wbbTeamInSeason, wbbFranchiseOf, wbbSeasonsOf]);
        expect(w.teams.byEspnId(2628)!.team_id).toBe(2628); // TCU: the ESPN id is the key
        expect(w.teams.seasonsOf(2628, 2026)).toEqual(LEAGUES.wbb.seasons); // R-W2: a core team's picker lists every season
    });
    test("regulation: halves through 2014-15, quarters from 2015-16; the game's own count wins (spec §3.1, D14)", () => {
        for (const s of [2003, 2008, 2014, 2015]) expect(regulationFor('wbb', s), String(s)).toEqual(HALF);
        for (const s of [2016, 2026, 2027]) expect(regulationFor('wbb', s), String(s)).toEqual(QUARTER);
        expect(regulationFor('wbb', null)).toEqual(QUARTER);              // undated: the current era
        expect(regulationFor('wbb', 2014, 2.0)).toEqual(HALF);           // 400550784's schedule row
        expect(regulationFor('wbb', 2026, 4.0)).toEqual(QUARTER);
        expect(regulationFor('wbb', 2015, 4)).toEqual(QUARTER);          // data beats the cutoff
        expect(BASKETBALL.wbb.overtimeMinutes).toBe(5);
    });
    test('season length and games in scope (measured, fixtures); leader bars (D31); her season; no college threshold pinned here (R6)', () => {
        for (const g of GAMES) expect(wbbSeasonGames(g.season), String(g.season)).toBe(g.median);
        const SCOPE: { season: number; median: number }[] = fix('games_in_scope');
        expect(SCOPE.map((g) => g.season)).toEqual(GAMES.map((g) => g.season));
        for (const g of SCOPE) expect(wbbGamesInScope(g.season), String(g.season)).toBe(g.median);
        expect([wbbGamesInScope(2026), wbbGamesInScope(2021)]).toEqual([32, 23]);
        expect(wbbGamesInScope(2027)).toBe(wbbGamesInScope(2026)); // a season past the table takes the latest
        expect(BASKETBALL.wbb.gamesInScope).toBe(wbbGamesInScope); // D44: the wiring; plan #11 pins rankMins / minFga on it
        for (const b of BARS) expect(wbbLeaderBars(b.season), String(b.season)).toEqual({ fga: b.fga, fg3a: b.fg3a });
        expect(BASKETBALL.wbb.leaderBars(2026)).toEqual({ fga: 3, fg3a: 2 }); // D31, pinned: 58.96 / 88.91 FGA per team game
        for (const s of [2003, 2027]) expect(wbbLeaderBars(s), String(s)).toEqual({ fga: 3, fg3a: 2 }); // outside the measured 2019-2026: the same constant
        expect(BASKETBALL.wbb.regularSeasonGames).toBe(wbbSeasonGames);
        expect(wbbSeasonGames(2027)).toBe(wbbSeasonGames(2026));
        expect(BASKETBALL.wbb.pronoun).toBe('her');
        // R6 / review I4: rankMins('wbb', …) and minFga scale by gamesInScope and are plan #11's pins.
        // No featured team is a PRESENT null highlight; 'her' is not the islands' default, so the pronoun key is emitted
        const ip = islandLeagueProps('wbb', 2026);
        expect('highlight' in ip).toBe(true);
        expect(ip).toMatchObject({ highlight: null, pronoun: 'her' });
    });
    test("scoreboard: the 2002-11-10 floor, the ET day, span labels, Top 25 default + D-I 50 + 32 women's conferences", () => {
        const w = BASKETBALL.wbb;
        expect(parseDateParam('2002-11-09', '2026-10-12', w.firstScoreboardDay)).toEqual({ ok: false, reason: 'range' });
        expect(parseDateParam('2002-11-10', '2026-10-12', w.firstScoreboardDay)).toEqual({ ok: true, date: '2002-11-10' });
        expect(seasonLabelFor('wbb', 2026)).toBe('2025-26');
        expect(gameHref('wbb', 401805076)).toBe('/wbb/game/401805076');
        expect([w.scoreboardTimeZone, w.scoreboardRefresh, w.featuredTeam, w.landing]).toEqual(['America/New_York', 60, null, 'teams-index']);
        expect(w.headerMenu).toEqual([{ label: 'Scoreboard', path: '/scoreboard' }]);
        expect(w.scoreboardGroups).toEqual({ default: 'top25', all: '50', conferences: WBB_CONFERENCES });
        expect(w.espnRimPlaceholder).toBe(true);
        expect([w.scoreboardGrouping, w.linesFromSeason]).toEqual(['status', 2026]); // D36 (R11), D39 (R12: measured, Decision 8)
    });
    test('the WP panel names the model with only what sdv-py records (D21, D37)', () => {
        expect(BASKETBALL.wbb.wpModelNote).toBe("Game on Paper's women's college basketball in-game model (sdv-py wbb_in_game_wp.ubj, trained on the season before the pregame gate season; it does not use the period as a feature).");
        expect(BASKETBALL.wbb.wpModelNote).not.toMatch(/20\d\d/); // D37: no season sdv-py does not record
    });
    test("NCAA women's courts by season (Step 2 rulebook figures; D32/R5 restricted eras and D45/R1 corner, plan #7's table)", () => {
        const at = (s: number) => courtFor('wbb', s);
        expect([2003, 2011, 2012, 2021, 2022, 2026].map((s) => at(s).threeRadius)).toEqual([ft(19, 9), ft(19, 9), ft(20, 9), ft(20, 9), ft(22, 1.75), ft(22, 1.75)]);
        expect([at(2011).threeCornerX, at(2021).threeCornerX]).toEqual([ft(19, 9), ft(20, 9)]);
        expect([at(2022).threeCornerX, at(2026).threeCornerX]).toEqual([NCAA_CORNER_X, NCAA_CORNER_X]); // 216.5625, the men's constant (R-W3)
        expect(NCAA_CORNER_X).toBeCloseTo(216.5625, 4);
        expect(at(2026).threeRadius).toBe(NCAA_ARC_NEW);
        expect([threeBreakY(at(2021)), Math.floor(threeBreakY(at(2022)))]).toEqual([0, 46]);
        // D32 / R5: none -> 3 ft from 2011-12 -> 4 ft from 2017-18 -> none from 2023-24 (plan #7's NCAA_RESTRICTED['wbb'])
        expect([2011, 2012, 2017, 2018, 2022, 2023, 2024, 2026].map((s) => at(s).restrictedRadius)).toEqual([0, 30, 30, 40, 40, 40, 0, 0]);
        expect([courtFor('mbb', 2021).threeRadius, courtFor('wbb', 2021).threeRadius]).toEqual([ft(22, 1.75), ft(20, 9)]); // the women moved two seasons later
        const SAME = ['halfWidth', 'baselineY', 'halfCourtY', 'rimRadius', 'backboardY', 'backboardHalfWidth', 'freeThrowY', 'circleRadius'] as const;
        expect(NCAA_W_COURTS.map((e) => e.from)).toEqual([2003, 2012, 2018, 2022, 2024]);
        for (const e of NCAA_W_COURTS) {
            expect(e.court.laneHalfWidth).toBe(60);    // 12 ft lane
            for (const k of SAME) expect(e.court[k], `${e.from} ${k}`).toBe(COURT[k]);
        }
        expect(NCAA_W_COURTS).not.toBe(NCAA_COURTS);
    });
    test('logos: ncaa by ESPN id, light and dark; the light logo is the plain id path (R-W1)', () => {
        expect(teamLogoUrl('wbb', '41', false)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/41.png');
        expect(teamLogoUrl('wbb', 41, false)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/41.png');
        expect(teamLogoUrl('wbb', 41, true)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500-dark/41.png');
        expect(darkLogoCss([{ id: '41', abbreviation: 'CONN' }], BASKETBALL.wbb.darkLogo))
            .toBe("img.team-logo-41{content:url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500-dark/41.png&h=120&w=120')}");
    });
    test('no team pages yet: plain team names', () => {
        expect(hasTeamPages('wbb')).toBe(false);
        expect(teamHrefFromEspn({ id: '41' }, 'wbb')).toBeNull();
    });
});
