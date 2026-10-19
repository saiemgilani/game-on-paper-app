import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor, hasTeamPages, islandLeagueProps, regulationFor, seasonLabelFor, statsSourceOf } from '../../src/basketball/config';
import { COURT, NCAA_ARC_NEW, NCAA_CORNER_X, NCAA_COURTS, threeBreakY } from '../../src/nba/data/court';
import { MBB_CONFERENCES, MBB_TEAMS, mbbFranchiseOf, mbbSeasonsOf, mbbTeamInSeason } from '../../src/nba/data/mbbTeams';
import { gameHref, teamHrefFromEspn } from '../../src/nba/links';
import { mbbGamesInScope, mbbLeaderBars, mbbSeasonGames } from '../../src/nba/seasonRange';
import { darkLogoCss, parseDateParam } from '../../src/nba/scoreboard';
import { LEAGUES, PREFIXED_LEAGUES, splitLeague, teamLogoUrl } from '../../src/utils/league';

const HALF = { periods: 2, kind: 'half', periodMinutes: 20 };
const ft = (f: number, i = 0) => (f + i / 12) * 10; // feet + inches -> legacy tenths
const GAMES: { season: number; median: number }[] = JSON.parse(readFileSync(new URL('../fixtures/mbb/season_games.json', import.meta.url)).toString());

describe('the mbb league entry', () => {
    test('identity and prefix', () => {
        expect(PREFIXED_LEAGUES).toEqual(['nfl', 'nba', 'wnba', 'mbb']);
        expect(splitLeague('/mbb/game/401820775')).toEqual({ league: 'mbb', rest: '/game/401820775' });
        const l = LEAGUES.mbb;
        expect([l.sport, l.name, l.shortName, l.urlPrefix, l.espnPath, l.espnCoreLeague, l.logoLeague, l.scoreboardCacheKey, l.sdvApiBase, l.sdvSchema, l.teamCount, l.pool, l.defaultGroup, l.scoreboardQuery])
            .toEqual(['basketball', "Men's College Basketball", 'MBB', '/mbb', 'mens-college-basketball', 'mens-college-basketball', 'ncaa', 'scoreboard:mbb', 'https://data.sportsdataverse.org/v1/mbb', 'mbb', 366, 'D-I', null, '']);
        expect([l.seasons[0], l.seasons.at(-1)]).toEqual([2003, 2026]);
    });
    test('sources: ESPN-keyed games and the mbb schema; no stats ids', () => {
        const m = BASKETBALL.mbb;
        expect(m.gamesSource).toEqual({ apiBase: 'https://data.sportsdataverse.org/v1/mbb', schema: 'mbb', namespace: 'mbb-games' });
        expect(statsSourceOf('mbb')).toEqual({ apiBase: 'https://data.sportsdataverse.org/v1/mbb', schema: 'mbb', namespace: 'mbb' });
        expect([m.statsLeagueId, m.regularGameIdPrefix, m.statsSourceLabel, m.shotDashboards]).toEqual([null, null, 'stats.ncaa.org', 'ncaa']);
        expect(m.teams.all).toBe(MBB_TEAMS);
        expect([m.teams.inSeason, m.teams.franchiseOf, m.teams.seasonsOf]).toEqual([mbbTeamInSeason, mbbFranchiseOf, mbbSeasonsOf]);
        expect(m.teams.byEspnId(2633)!.team_id).toBe(2633); // Tennessee: the ESPN id is the key
        expect(m.teams.seasonsOf(2633, 2026)).toEqual(LEAGUES.mbb.seasons); // R3: the season picker lists every season
    });
    test("regulation: always two 20-minute halves; the game's own count still wins (spec §3.1)", () => {
        for (const s of [2003, 2026, null]) expect(regulationFor('mbb', s)).toEqual(HALF);
        expect(regulationFor('mbb', 2026, 2.0)).toEqual(HALF);
        expect(BASKETBALL.mbb.overtimeMinutes).toBe(5);
    });
    test('season length and games in scope (measured, fixtures); his season; no college threshold pinned here (R6)', () => {
        for (const g of GAMES) expect(mbbSeasonGames(g.season), String(g.season)).toBe(g.median);
        const SCOPE: { season: number; median: number }[] = JSON.parse(readFileSync(new URL('../fixtures/mbb/games_in_scope.json', import.meta.url)).toString());
        expect(SCOPE.map((g) => g.season)).toEqual(GAMES.map((g) => g.season));
        for (const g of SCOPE) expect(mbbGamesInScope(g.season), String(g.season)).toBe(g.median);
        expect(mbbGamesInScope(2027)).toBe(mbbGamesInScope(2026)); // a season past the table takes the latest
        expect(BASKETBALL.mbb.gamesInScope).toBe(mbbGamesInScope); // D44: the wiring; plan #9 makes rankMins / the scatter bar read it and pins them
        for (const lg of ['nba', 'wnba'] as const) expect(Object.keys(BASKETBALL[lg])).not.toContain('gamesInScope');
        const BARS: { season: number; fga: number; fg3a: number }[] = JSON.parse(readFileSync(new URL('../fixtures/mbb/leader_bars.json', import.meta.url)).toString());
        for (const b of BARS) expect(mbbLeaderBars(b.season), String(b.season)).toEqual({ fga: b.fga, fg3a: b.fg3a });
        expect(BASKETBALL.mbb.leaderBars(2026)).toEqual({ fga: 3, fg3a: 2 }); // D31, pinned: 58.72 / 88.91 FGA per team game
        expect([mbbLeaderBars(2003), mbbLeaderBars(2027)]).toEqual([mbbLeaderBars(2019), mbbLeaderBars(2026)]); // nearest measured season
        expect(BASKETBALL.mbb.regularSeasonGames).toBe(mbbSeasonGames);
        expect(mbbSeasonGames(2027)).toBe(mbbSeasonGames(2026)); // a season past the table takes the latest length
        expect(BASKETBALL.mbb.pronoun).toBe('his');
        // R6 / review I4: rankMins('mbb', …) and islandLeagueProps' minFga are plan #9's pins (on gamesInScope), not this plan's.
        // R4: no featured team is a PRESENT null highlight; 'his' is the islands' default, so the pronoun key is omitted
        const ip = islandLeagueProps('mbb', 2026);
        expect(ip).toMatchObject({ highlight: null });
        expect(ip).not.toHaveProperty('pronoun');
    });
    test('scoreboard: the 2002-11-14 floor, the ET day, span labels, Top 25 default + D-I 50 + 32 conferences', () => {
        const m = BASKETBALL.mbb;
        expect(parseDateParam('2002-11-13', '2026-10-12', m.firstScoreboardDay)).toEqual({ ok: false, reason: 'range' });
        expect(parseDateParam('2002-11-14', '2026-10-12', m.firstScoreboardDay)).toEqual({ ok: true, date: '2002-11-14' });
        expect(seasonLabelFor('mbb', 2026)).toBe('2025-26');
        expect(gameHref('mbb', 401820775)).toBe('/mbb/game/401820775');
        expect([m.scoreboardTimeZone, m.scoreboardRefresh, m.featuredTeam, m.landing]).toEqual(['America/New_York', 60, null, 'teams-index']);
        expect(m.headerMenu).toEqual([{ label: 'Scoreboard', path: '/scoreboard' }]);
        expect(m.scoreboardGroups).toEqual({ default: 'top25', all: '50', conferences: MBB_CONFERENCES });
        expect(m.espnRimPlaceholder).toBe(true);
        expect([BASKETBALL.nba.scoreboardGroups, BASKETBALL.nba.espnRimPlaceholder, BASKETBALL.wnba.scoreboardGroups, BASKETBALL.wnba.espnRimPlaceholder]).toEqual([undefined, undefined, undefined, undefined]);
        expect(Object.keys(BASKETBALL.nba)).not.toContain('scoreboardGroups'); // the NBA object did not gain a key
    });
    test('the WP panel names the model with only what sdv-py records (D21, D37)', () => {
        expect(BASKETBALL.mbb.wpModelNote).toBe("Game on Paper's men's college basketball in-game model (sdv-py mbb_in_game_wp.ubj, trained on the season before the pregame gate season; it does not use the period as a feature).");
        expect(BASKETBALL.mbb.wpModelNote).not.toMatch(/20\d\d/); // D37: no season sdv-py does not record
    });
    test('NCAA courts by season (Step 2 rulebook figures)', () => {
        const at = (s: number) => courtFor('mbb', s);
        expect([2003, 2008, 2009, 2019, 2020, 2026].map((s) => at(s).threeRadius)).toEqual([ft(19, 9), ft(19, 9), ft(20, 9), ft(20, 9), ft(22, 1.75), ft(22, 1.75)]);
        expect([at(2008).threeCornerX, at(2019).threeCornerX]).toEqual([ft(19, 9), ft(20, 9)]);
        // D45 / R1 (owner amendment 2026-10-12): one corner constant in both repos, the rulebook's 21' 7 7/8" = 216.5625 tenths
        // (sdv-db NEW_COURT.three_corner_x = (21 * 12 + 7.875) / 1.2)
        expect(NCAA_CORNER_X).toBeCloseTo(216.5625, 4);
        expect(at(2026).threeCornerX).toBe(NCAA_CORNER_X);
        expect(NCAA_ARC_NEW).toBeCloseTo(221.4583, 4);              // 22' 1 3/4" (Step 2; plan #9 Task 1 Step 0 compares with plan #7's radius)
        expect(Math.floor(threeBreakY(at(2026)))).toBe(46);         // the integer-tenth row where corner threes end (R1; plan #9 Step 0)
        // D32 / R5: none before 2011-12, 3 ft from 2011-12, 4 ft from 2015-16 (plan #7's eras, mirrored)
        expect([2011, 2012, 2015, 2016, 2020, 2026].map((s) => at(s).restrictedRadius)).toEqual([0, 30, 30, 40, 40, 40]);
        expect([threeBreakY(at(2019)), threeBreakY(at(2026)) > 0]).toEqual([0, true]);
        const SAME = ['halfWidth', 'baselineY', 'halfCourtY', 'rimRadius', 'backboardY', 'backboardHalfWidth', 'freeThrowY', 'circleRadius'] as const;
        for (const e of NCAA_COURTS) {
            expect(e.court.laneHalfWidth).toBe(60); // 12 ft lane
            for (const k of SAME) expect(e.court[k], `${e.from} ${k}`).toBe(COURT[k]);
        }
    });
    test('logos: ncaa by ESPN id, light and dark; the light logo is the plain id path (R5)', () => {
        expect(teamLogoUrl('mbb', '150', false)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/150.png');
        expect(teamLogoUrl('mbb', 150, false)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/150.png');
        expect(teamLogoUrl('mbb', 150, true)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500-dark/150.png');
        expect(darkLogoCss([{ id: '150', abbreviation: 'DUKE' }], BASKETBALL.mbb.darkLogo))
            .toBe("img.team-logo-150{content:url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/ncaa/500-dark/150.png&h=120&w=120')}");
    });
    test('no team pages yet: plain team names', () => {
        expect(hasTeamPages('mbb')).toBe(false);
        expect(teamHrefFromEspn({ id: '150' }, 'mbb')).toBeNull();
    });
});
