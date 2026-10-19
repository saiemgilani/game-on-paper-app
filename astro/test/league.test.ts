import { afterEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEAGUES, NFL_LOGO_ABBR, leagueFromLocation, leaguePath, meetingLabel, nflRegularSeasonWeeks, splitLeague, teamLogoUrl, weekLabel } from '../src/utils/league';

describe('splitLeague', () => {
    test('strips the nfl prefix and keeps everything else', () => {
        expect(splitLeague('/nfl/game/401772944')).toEqual({ league: 'nfl', rest: '/game/401772944' });
        expect(splitLeague('/nfl')).toEqual({ league: 'nfl', rest: '/' });
        expect(splitLeague('/nfl/')).toEqual({ league: 'nfl', rest: '/' });
        expect(splitLeague('/game/1')).toEqual({ league: 'cfb', rest: '/game/1' });
        expect(splitLeague('/nflx/anything')).toEqual({ league: 'cfb', rest: '/nflx/anything' });
        expect(splitLeague('/')).toEqual({ league: 'cfb', rest: '/' });
    });
});

describe('leaguePath', () => {
    test('is the identity for cfb and undefined', () => {
        expect(leaguePath('cfb', '/game/1')).toBe('/game/1');
        expect(leaguePath(undefined, '/teams/')).toBe('/teams/');
    });
    test('prefixes nfl and collapses the root', () => {
        expect(leaguePath('nfl', '/game/1')).toBe('/nfl/game/1');
        expect(leaguePath('nfl', '/')).toBe('/nfl');
        expect(leaguePath('nfl', '/nfl/game/1')).toBe('/nfl/game/1'); // never double-prefixes
    });
});

describe('LEAGUES', () => {
    test('cfb keeps every value the site uses today', () => {
        expect(LEAGUES.cfb).toMatchObject({
            urlPrefix: '', espnPath: 'college-football', defaultGroup: 80, scoreboardCacheKey: 'scoreboard',
            sdvEnabled: true, sdvApiBase: 'https://data.sportsdataverse.org/v1/cfb',
        });
        expect(LEAGUES.cfb.scoreboardQuery).toBe('group=80&limit=1000&');
    });
    test('nfl differs only where ESPN and the data differ', () => {
        expect(LEAGUES.nfl).toMatchObject({
            urlPrefix: '/nfl', espnPath: 'nfl', espnCoreLeague: 'nfl', defaultGroup: null, scoreboardQuery: '',
            scoreboardCacheKey: 'scoreboard:nfl', sdvEnabled: true, regularSeasonWeeks: 18, postseasonWeeks: 5,
        });
        expect(LEAGUES.nfl.seasons[0]).toBe(2002);
    });
});

describe('teamLogoUrl', () => {
  test('NFL dark logos use the abbreviation path (numeric 500-dark is a 404)', () => {
    expect(teamLogoUrl('nfl', 8, true)).toBe('https://a.espncdn.com/i/teamlogos/nfl/500-dark/det.png');
    expect(teamLogoUrl('nfl', '18', true)).toBe('https://a.espncdn.com/i/teamlogos/nfl/500-dark/no.png');
  });
  test('NFL light logos keep the numeric path', () => {
    expect(teamLogoUrl('nfl', 8, false)).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/8.png');
  });
  test('an NFL id outside the map falls back to the light logo, never a dead dark URL', () => {
    expect(teamLogoUrl('nfl', 999, true)).toBe('https://a.espncdn.com/i/teamlogos/nfl/500/999.png');
  });
  test('CFB keeps numeric ids in both modes', () => {
    expect(teamLogoUrl('cfb', 251, true)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500-dark/251.png');
    expect(teamLogoUrl(undefined, 251, false)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/251.png');
  });
  test('the map covers all 32 NFL teams with distinct abbreviations', () => {
    expect(Object.keys(NFL_LOGO_ABBR)).toHaveLength(32);
    expect(new Set(Object.values(NFL_LOGO_ABBR)).size).toBe(32);
  });
});

describe('nflRegularSeasonWeeks', () => {
    test('17 through 2020, 18 from 2021, 18 when the season is unknown', () => {
        expect(nflRegularSeasonWeeks(1999)).toBe(17);
        expect(nflRegularSeasonWeeks(2020)).toBe(17);
        expect(nflRegularSeasonWeeks(2021)).toBe(18);
        expect(nflRegularSeasonWeeks(2025)).toBe(18);
        expect(nflRegularSeasonWeeks('2020')).toBe(17);
        expect(nflRegularSeasonWeeks(undefined)).toBe(18);
    });
});

describe('weekLabel', () => {
    test('names the NFL postseason round rather than its nflverse week number', () => {
        // 2021 onwards: regular season 1-18, postseason 19-22
        expect(weekLabel('nfl', 19, 'postseason', 2024)).toBe('Wild Card');
        expect(weekLabel('nfl', 20, 'postseason', 2024)).toBe('Divisional');
        expect(weekLabel('nfl', 21, 'postseason', 2024)).toBe('Conference Championship');
        expect(weekLabel('nfl', 22, 'postseason', 2024)).toBe('Super Bowl');
        expect(weekLabel('nfl', 5, 'regular', 2024)).toBe('Week 5');
        expect(weekLabel('nfl', 18, 'regular', 2024)).toBe('Week 18');
    });
    test('a 17-week season shifts every round down one', () => {
        // 1999-2020: regular season 1-17, postseason 18-21 -- week 19 is the
        // DIVISIONAL round in 2019, not the Wild Card round
        expect(weekLabel('nfl', 18, 'postseason', 2019)).toBe('Wild Card');
        expect(weekLabel('nfl', 19, 'postseason', 2019)).toBe('Divisional');
        expect(weekLabel('nfl', 20, 'postseason', 2019)).toBe('Conference Championship');
        expect(weekLabel('nfl', 21, 'postseason', 2019)).toBe('Super Bowl');
        expect(weekLabel('nfl', 21, 'postseason', 2020)).toBe('Super Bowl');
        // and the 2021 boundary is the other way round
        expect(weekLabel('nfl', 18, 'postseason', 2021)).toBe('Postseason');
    });
    test('cfb and an unknown round stay generic', () => {
        expect(weekLabel('cfb', 12, 'regular')).toBe('Week 12');
        expect(weekLabel('cfb', 1, 'postseason')).toBe('Postseason');
        expect(weekLabel('nfl', 40, 'postseason', 2024)).toBe('Postseason');
        expect(weekLabel('nfl', 22, 'postseason', 2019)).toBe('Postseason');
        expect(weekLabel('nfl', null, null)).toBe('');
    });
    test('no season reads as the current era', () => {
        expect(weekLabel('nfl', 19, 'postseason')).toBe('Wild Card');
        expect(weekLabel('nfl', 22, 'postseason')).toBe('Super Bowl');
    });

    // A postseason `week` restarts at 1 in BOTH leagues, so the bare number
    // labels a bowl game / a Super Bowl "1". The CFB fixture carries exactly
    // that row, which is why this is a contract and not a hypothetical.
    test('a postseason row is named, never numbered', () => {
        const cfb = JSON.parse(readFileSync(new URL('./fixtures/player-cfb-4433971-2024.json', import.meta.url)).toString());
        const post = cfb.games.data.find((g: any) => g.season_type === 'postseason');
        expect(post.week).toBe(1);
        expect(weekLabel('cfb', post.week, post.season_type)).toBe('Postseason');
        expect(weekLabel('nfl', 1, 'POST', 2026)).toBe('Wild Card');
        expect(weekLabel('nfl', 4, 'POST', 2026)).toBe('Super Bowl');
        // a round the league has not defined still says postseason, not "1"
        expect(weekLabel('nfl', 9, 'POST', 2026)).toBe('Postseason');
    });

    test('a regular-season row is its number, and an absent week an em dash', () => {
        expect(weekLabel('cfb', 7, 'regular')).toBe('Week 7');
        expect(weekLabel('nfl', 18, 'REG')).toBe('Week 18');
        expect(weekLabel('nfl', null, 'REG')).toBe('');
    });
});

describe('meetingLabel', () => {
    const game = {
        season: 2025, week: 11, season_type: 'regular', away_abbreviation: 'CAR', away_team: 'Carolina Panthers',
        away_points: 30, home_abbreviation: 'ATL', home_team: 'Atlanta Falcons', home_points: 27,
    };
    test('reads away-then-home, with the abbreviation and a colon separator', () => {
        expect(meetingLabel(game, 'nfl')).toBe('Week 11: CAR 30-27 ATL');
    });
    test('falls back to the full name and drops the prefix when the week is unknown', () => {
        expect(meetingLabel({ ...game, away_abbreviation: undefined, home_abbreviation: undefined }, 'nfl'))
            .toBe('Week 11: Carolina Panthers 30-27 Atlanta Falcons');
        expect(meetingLabel({ ...game, week: null }, 'nfl')).toBe('CAR 30-27 ATL');
    });
    test('takes the postseason round from the game season, not the week alone', () => {
        const post = { ...game, season_type: 'postseason', week: 19 };
        expect(meetingLabel(post, 'nfl')).toBe('Wild Card: CAR 30-27 ATL');
        expect(meetingLabel({ ...post, season: 2019 }, 'nfl')).toBe('Divisional: CAR 30-27 ATL');
    });
});

describe('the nba league', () => {
    test('is a basketball league under /nba reading the nba_stats schema', () => {
        expect(LEAGUES.nba).toMatchObject({
            slug: 'nba', sport: 'basketball', urlPrefix: '/nba', espnPath: 'nba', espnCoreLeague: 'nba',
            sdvApiBase: 'https://data.sportsdataverse.org/v1/nba_stats', sdvSchema: 'nba_stats', sdvEnabled: true,
            logoLeague: 'nba', teamCount: 30, defaultGroup: null, scoreboardQuery: '', regularSeasonWeeks: 0,
        });
        expect(LEAGUES.nba.seasons[0]).toBe(1998);
        expect(LEAGUES.nba.seasons.at(-1)).toBe(2026);
        expect(LEAGUES.cfb.sport).toBe('football');
        expect(LEAGUES.nfl.sport).toBe('football');
        expect(LEAGUES.cfb.sdvSchema).toBe('cfb');
        expect(LEAGUES.nfl.sdvSchema).toBe('nfl');
    });
    test('splitLeague and leaguePath know the /nba prefix', () => {
        expect(splitLeague('/nba')).toEqual({ league: 'nba', rest: '/' });
        expect(splitLeague('/nba/players/1629008')).toEqual({ league: 'nba', rest: '/players/1629008' });
        expect(splitLeague('/nbax/anything')).toEqual({ league: 'cfb', rest: '/nbax/anything' });
        expect(leaguePath('nba', '/')).toBe('/nba');
        expect(leaguePath('nba', '/players/1')).toBe('/nba/players/1');
        expect(leaguePath('nba', '/nba/players/1')).toBe('/nba/players/1');
    });
    test('nba logos use ESPN numeric ids in both modes', () => {
        expect(teamLogoUrl('nba', 17, false)).toBe('https://a.espncdn.com/i/teamlogos/nba/500/17.png');
        expect(teamLogoUrl('nba', 17, true)).toBe('https://a.espncdn.com/i/teamlogos/nba/500-dark/17.png');
    });
});

describe('leagueFromLocation (client-side, e.g. the WP chart\'s logos)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    const at = (pathname: string) => { vi.stubGlobal('window', { location: { pathname } }); return leagueFromLocation(); };
    test('an admin preview link (/preview/<league>/...) is that league, not cfb', () => {
        expect(at('/preview/wnba/game/1')).toBe('wnba');
        expect(at('/preview/nba/game/1')).toBe('nba');
        expect(at('/preview/nfl/game/1')).toBe('nfl');
        expect(at('/preview')).toBe('cfb');
        expect(at('/preview/game/1')).toBe('cfb');
    });
    test('public paths are unchanged', () => {
        expect(at('/wnba/game/1')).toBe('wnba');
        expect(at('/game/1')).toBe('cfb');
        expect(at('/previewx/wnba/game/1')).toBe('cfb');
    });
});
