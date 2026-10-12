import { describe, expect, test } from 'vitest';
import { gameHref, playerHref, scoreboardDayHref, teamHref, teamHrefFromEspn } from '../../src/nba/links';
import { darkLogoCss, parseDateParam, scoreboardBackHref } from '../../src/nba/scoreboard';
import { BASKETBALL } from '../../src/basketball/config';

describe('league-aware links (NBA values unchanged)', () => {
    test('hrefs', () => {
        expect(playerHref(1629008, '?season=2025')).toBe('/nba/players/1629008?season=2025');
        expect(playerHref(1629008, '', 'nba')).toBe('/nba/players/1629008');
        expect(teamHref(1610612751, '', 'nba')).toBe('/nba/team/1610612751');
        expect(teamHrefFromEspn({ id: '17' }, 'nba')).toBe('/nba/team/1610612751');
        expect(teamHrefFromEspn({ id: '999' }, 'nba')).toBeNull();
        expect(gameHref('nba', 401766458)).toBe('/nba/game/401766458');
    });
    test('scoreboardDayHref equals the NBA scoreboardBackHref on the days #318 pinned', () => {
        for (const d of ['2026-10-22T01:00:00Z', '2025-04-15T23:30Z', '1990-01-01T00:00Z', null]) {
            expect(scoreboardDayHref('nba', d, '2026-10-21')).toBe(scoreboardBackHref(d, '2026-10-21'));
        }
        expect(scoreboardDayHref('nba', '2026-10-22T01:00:00Z', '2026-10-21')).toBe('/nba/scoreboard?date=2026-10-21');
    });
    test('the ?date= floor comes from the config', () => {
        expect(parseDateParam('1997-09-30', '2026-10-12', BASKETBALL.nba.firstScoreboardDay)).toEqual({ ok: false, reason: 'range' });
        expect(parseDateParam('1997-10-01', '2026-10-12')).toEqual({ ok: true, date: '1997-10-01' });
        expect(parseDateParam('2025-01-15', '2026-10-12', '2025-01-16')).toEqual({ ok: false, reason: 'range' });
    });
    test('dark logos: the NBA abbr list by default, id paths and none for other strategies', () => {
        const teams = [{ id: '17', abbreviation: 'BKN' }, { id: '1', abbreviation: 'ZZZ' }];
        expect(darkLogoCss(teams)).toBe(darkLogoCss(teams, BASKETBALL.nba.darkLogo));
        expect(darkLogoCss(teams)).toContain('/i/teamlogos/nba/500-dark/bkn.png');
        expect(darkLogoCss(teams)).not.toContain('team-logo-1{');
        expect(darkLogoCss(teams, { kind: 'id', logoLeague: 'ncaa' })).toContain('/i/teamlogos/ncaa/500-dark/1.png');
        expect(darkLogoCss(teams, { kind: 'none' })).toBe('');
    });
});
