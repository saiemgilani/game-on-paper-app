import { describe, expect, test } from 'vitest';
import { LEAGUES, NFL_LOGO_ABBR, leaguePath, meetingLabel, splitLeague, teamLogoUrl, weekLabel } from '../src/utils/league';

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

describe('weekLabel', () => {
    test('names the NFL postseason round rather than its nflverse week number', () => {
        // nfl.espn_schedule numbers the postseason 19-22, continuing the regular season
        expect(weekLabel('nfl', 19, 'postseason')).toBe('Wild Card');
        expect(weekLabel('nfl', 22, 'postseason')).toBe('Super Bowl');
        expect(weekLabel('nfl', 5, 'regular')).toBe('Week 5');
        expect(weekLabel('nfl', 18, 'regular')).toBe('Week 18');
    });
    test('cfb and an unknown round stay generic', () => {
        expect(weekLabel('cfb', 12, 'regular')).toBe('Week 12');
        expect(weekLabel('cfb', 1, 'postseason')).toBe('Postseason');
        expect(weekLabel('nfl', 40, 'postseason')).toBe('Postseason');
        expect(weekLabel('nfl', null, null)).toBe('');
    });
});

describe('meetingLabel', () => {
    const game = {
        week: 11, season_type: 'regular', away_abbreviation: 'CAR', away_team: 'Carolina Panthers',
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
});
