import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, courtFor, hasTeamPages, regulationFor, seasonLabelFor, splitAtRestrictedArea, statsSourceOf } from '../../src/basketball/config';
import { COURT, WNBA_COURT, WNBA_RESTRICTED_AREA, courtLines, threeBreakY, viewport } from '../../src/nba/data/court';
import { WNBA_TEAMS, wnbaLogoId } from '../../src/nba/data/wnbaTeams';
import { gameHref, scoreboardDayHref, teamHrefFromEspn } from '../../src/nba/links';
import { darkLogoCss, parseDateParam } from '../../src/nba/scoreboard';
import { LEAGUES, PREFIXED_LEAGUES, WNBA_HOSTED_LOGOS, WNBA_LOGO_ABBR, splitLeague, teamLogoUrl } from '../../src/utils/league';

const HALF = { periods: 2, kind: 'half', periodMinutes: 20 };
const QUARTER = { periods: 4, kind: 'quarter', periodMinutes: 10 };

describe('the wnba league entry', () => {
    test('identity and prefix', () => {
        expect(PREFIXED_LEAGUES).toEqual(['nfl', 'nba', 'wnba']);
        expect(splitLeague('/wnba/game/401736287')).toEqual({ league: 'wnba', rest: '/game/401736287' });
        expect(splitLeague('/wnba')).toEqual({ league: 'wnba', rest: '/' });
        expect(splitLeague('/nba/game/1')).toEqual({ league: 'nba', rest: '/game/1' });
        const l = LEAGUES.wnba;
        expect([l.sport, l.name, l.shortName, l.urlPrefix, l.espnPath, l.espnCoreLeague, l.logoLeague, l.scoreboardCacheKey, l.sdvApiBase, l.sdvSchema, l.teamCount])
            .toEqual(['basketball', 'WNBA', 'WNBA', '/wnba', 'wnba', 'wnba', 'wnba', 'scoreboard:wnba', 'https://data.sportsdataverse.org/v1/wnba_stats', 'wnba_stats', 15]);
        expect([l.seasons[0], l.seasons.at(-1)]).toEqual([1997, 2026]);
    });
    test('sources and stats ids', () => {
        const w = BASKETBALL.wnba;
        expect(w.gamesSource).toEqual({ apiBase: 'https://data.sportsdataverse.org/v1/wnba', schema: 'wnba', namespace: 'wnba-games' });
        expect(statsSourceOf('wnba')).toEqual({ apiBase: 'https://data.sportsdataverse.org/v1/wnba_stats', schema: 'wnba_stats', namespace: 'wnba' });
        expect([w.statsLeagueId, w.regularGameIdPrefix, w.statsSourceLabel, w.shotDashboards]).toEqual(['10', '102', 'stats.wnba.com', 'stats-api']);
        expect(w.teams.all).toBe(WNBA_TEAMS);
    });
    test("regulation: halves before 2006, quarters from 2006, the game's own count first (spec §3.1, D14)", () => {
        expect(regulationFor('wnba', 2005)).toEqual(HALF);
        expect(regulationFor('wnba', 2006)).toEqual(QUARTER);
        expect(regulationFor('wnba', 2005, 2)).toEqual(HALF);
        expect(regulationFor('wnba', 2025, 4.0)).toEqual(QUARTER);
        expect(regulationFor('wnba', null)).toEqual(QUARTER);
        expect(BASKETBALL.wnba.overtimeMinutes).toBe(5);
    });
    test('scoreboard: the 2002-05-25 floor, the ET day, year labels, no featured team, Scoreboard-only menu, teams-index landing', () => {
        const w = BASKETBALL.wnba;
        expect(parseDateParam('2002-05-24', '2026-10-12', w.firstScoreboardDay)).toEqual({ ok: false, reason: 'range' });
        expect(parseDateParam('2002-05-25', '2026-10-12', w.firstScoreboardDay)).toEqual({ ok: true, date: '2002-05-25' });
        expect(scoreboardDayHref('wnba', '2025-08-02T02:00Z', '2026-10-12')).toBe('/wnba/scoreboard?date=2025-08-01'); // a 10 pm ET tip
        expect(scoreboardDayHref('wnba', '2001-06-02T20:00Z', '2026-10-12')).toBe('/wnba/scoreboard');
        expect(gameHref('wnba', 401736287)).toBe('/wnba/game/401736287');
        expect(seasonLabelFor('wnba', 2025)).toBe('2025');
        expect([w.scoreboardTimeZone, w.scoreboardRefresh, w.featuredTeam, w.landing]).toEqual(['America/New_York', 60, null, 'teams-index']);
        expect(w.headerMenu).toEqual([{ label: 'Scoreboard', path: '/scoreboard' }]);
    });
    test("court eras equal sdv-db's WNBA_COURTS era for era, restricted radius included (D32, resolution R5)", () => {
        type Era = { from: number; laneHalfWidth: number; threeRadius: number; threeCornerX: number; restrictedRadius: number };
        const SDV_DB: Era[] = JSON.parse(readFileSync(new URL('../fixtures/wnba/sdv_db_wnba_courts.json', import.meta.url)).toString()).courts;
        const eras = BASKETBALL.wnba.courts;
        expect(eras.map((e) => e.from)).toEqual(SDV_DB.map((r) => r.from));
        eras.forEach((e, i) => {
            const r = SDV_DB[i];
            expect(e.court.laneHalfWidth, String(e.from)).toBe(r.laneHalfWidth);
            expect(e.court.threeRadius, String(e.from)).toBeCloseTo(r.threeRadius, 9);
            expect(e.court.threeCornerX, String(e.from)).toBeCloseTo(r.threeCornerX, 9);
            expect(e.court.restrictedRadius, String(e.from)).toBe(r.restrictedRadius);
        });
        // the adoption season plan #3 records: no arc the season before, the recorded radius from it, 4 ft in 2026
        expect(courtFor('wnba', WNBA_RESTRICTED_AREA.from - 1).restrictedRadius).toBe(0);
        expect(courtFor('wnba', WNBA_RESTRICTED_AREA.from).restrictedRadius).toBe(WNBA_RESTRICTED_AREA.radius);
        expect(courtFor('wnba', 2026).restrictedRadius).toBe(40); // 2026 rulebook Rule No. 1 Section I(i): 4 ft
        expect(courtFor('nba', 1998)).toBe(COURT); // the NBA's one court, untouched
    });
    test('splitAtRestrictedArea: literal eras, a court that already has the radius is kept as is', () => {
        const a = { ...COURT, threeRadius: 200 }, b = { ...COURT, threeRadius: 210 };
        const out = splitAtRestrictedArea([{ from: 1997, court: a }, { from: 2004, court: b }], { from: 2000, radius: 40 });
        expect(out.map((e) => [e.from, e.court.threeRadius, e.court.restrictedRadius])).toEqual([[1997, 200, 0], [2000, 200, 40], [2004, 210, 40]]);
        expect(out[2].court).toBe(b); // b already carries COURT's 40
    });
    test('no restricted arc is drawn before adoption; the NBA draws its arc as before', () => {
        const v = viewport(500, 350, 25);
        const names = (season: number) => courtLines(v, courtFor('wnba', season)).map((l) => l.name);
        expect(names(WNBA_RESTRICTED_AREA.from - 1)).not.toContain('restricted-area');
        expect(names(WNBA_RESTRICTED_AREA.from)).toContain('restricted-area');
        expect(courtLines(v, COURT).map((l) => l.name)).toContain('restricted-area');
    });
    test("2013+ lines: the 2026 rulebook's 22' 1 3/4\" arc, corners 36\" from the sidelines, lines meeting the arc 93 1/3\" from the baseline", () => {
        expect(courtFor('wnba', 2026)).toBe(WNBA_COURT); // the 2026 rulebook has the 4 ft arc, so the latest era is WNBA_COURT itself
        expect(WNBA_COURT.threeRadius).toBeCloseTo((22 * 12 + 1.75) / 12 * 10, 9);
        expect(WNBA_COURT.threeCornerX).toBe(250 - 30); // 25 ft half width less 36"
        expect(Math.abs(threeBreakY(WNBA_COURT) - ((93 + 1 / 3 - 63) / 12) * 10)).toBeLessThan(0.2); // the rim is 63" off the baseline
        expect(Object.entries(WNBA_COURT).filter(([k, v]) => (COURT as Record<string, number>)[k] !== v).map(([k]) => k)).toEqual(['threeRadius']);
        expect([threeBreakY(courtFor('wnba', 2003)), threeBreakY(courtFor('wnba', 2008))]).toEqual([0, 0]); // one arc to the rim line before 2013
    });
    test('the WP note names the model by what sdv-py records; the NBA sentence is unchanged (D21, D37, R13)', () => {
        expect(BASKETBALL.nba.wpModelNote).toBe("Game on Paper's in-game model: score margin, time remaining, the pregame prior and possession.");
        expect(BASKETBALL.wnba.wpModelNote).toBe(
            "Game on Paper's WNBA in-game model (sdv-py wnba_in_game_wp.ubj): score margin, time remaining, the pregame prior and possession. The pregame home edge was fitted on 220 of 264 2024 WNBA games.",
        );
        expect(BASKETBALL.wnba.wpModelNote).not.toMatch(/trained on|one season/); // no unrecorded training claim
    });
    test('logos: by abbreviation, the probe of 2026-10-12', () => {
        // the 15 current teams plus the three defunct franchises ESPN still serves a logo for (probe 2026-10-18)
        expect(Object.keys(WNBA_LOGO_ABBR).sort()).toEqual([...WNBA_TEAMS.map((t) => String(t.espn_id)), '1', '4', '13'].sort());
        expect(teamLogoUrl('wnba', '129689', false)).toBe('https://a.espncdn.com/i/teamlogos/wnba/500/gs.png');
        expect(teamLogoUrl('wnba', 20, true)).toBe('https://a.espncdn.com/i/teamlogos/wnba/500-dark/atl.png');
        expect(teamLogoUrl('wnba', 1, false)).toBe('https://a.espncdn.com/i/teamlogos/wnba/500/cha.png'); // the defunct Sting, by abbreviation
        // Cleveland (2), Miami (7) and the 2000-02 Portland Fire (12) have no ESPN logo: the site hosts theirs, one file for light and dark
        for (const [id, file] of [['2', 'cle'], ['7', 'mia'], ['12', 'por-2000']]) for (const dark of [false, true]) {
            expect(teamLogoUrl('wnba', id, dark)).toBe(`/assets/img/wnba/${file}.png`);
            expect(teamLogoUrl('wnba', id, dark, 2002)).toBe(`/assets/img/wnba/${file}.png`);
        }
        // ESPN files the old Fire under the 2026 Fire's 132052: through 2002 that is the old Fire's logo, from 2026 the new one's
        for (const dark of [false, true]) expect(teamLogoUrl('wnba', 132052, dark, 2002)).toBe('/assets/img/wnba/por-2000.png');
        expect(teamLogoUrl('wnba', 132052, false, 2026)).toBe('https://a.espncdn.com/i/teamlogos/wnba/500/por.png');
        expect(teamLogoUrl('wnba', 132052, true)).toBe('https://a.espncdn.com/i/teamlogos/wnba/500-dark/por.png'); // no season: the current team
        // every hosted file exists, is a PNG and stays small
        for (const path of Object.values(WNBA_HOSTED_LOGOS)) {
            const bytes = readFileSync(new URL(`../../public${path}`, import.meta.url));
            expect(bytes.subarray(1, 4).toString()).toBe('PNG');
            expect(bytes.length).toBeLessThan(20_000);
        }
        // a season never moves another league's logo
        expect(teamLogoUrl('nba', 12, false, 2002)).toBe('https://a.espncdn.com/i/teamlogos/nba/500/12.png');
        expect(teamLogoUrl('cfb', 2, true, 2002)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500-dark/2.png');
        expect(teamLogoUrl('nba', 17, true)).toBe('https://a.espncdn.com/i/teamlogos/nba/500-dark/17.png'); // the NBA unchanged
        expect(darkLogoCss([{ id: '129689', abbreviation: 'GS' }, { id: '1', abbreviation: 'CHA' }], BASKETBALL.wnba.darkLogo))
            .toBe("img.team-logo-129689{content:url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/wnba/500-dark/gs.png&h=120&w=120')}"
                + "img.team-logo-1{content:url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/wnba/500-dark/cha.png&h=120&w=120')}");
        // D22: keyed by ESPN id, so a 2005 board's WAS (today wsh) still gets the current dark logo
        expect(BASKETBALL.wnba.darkLogo).toEqual({ kind: 'idKeyed', logoLeague: 'wnba', abbrById: WNBA_LOGO_ABBR, logoId: wnbaLogoId });
        // the old Fire's 132052 on a 2002 board gets no dark rule (its hosted light file stands); the 2026 Fire's does
        expect(darkLogoCss([{ id: '132052', abbreviation: 'POR', season: 2002 }], BASKETBALL.wnba.darkLogo)).toBe('');
        expect(darkLogoCss([{ id: '132052', abbreviation: 'POR', season: 2026 }], BASKETBALL.wnba.darkLogo)).toContain('/wnba/500-dark/por.png');
        expect(darkLogoCss([{ id: '16', abbreviation: 'WAS' }], BASKETBALL.wnba.darkLogo)).toContain('/i/teamlogos/wnba/500-dark/wsh.png');
        expect(BASKETBALL.nba.darkLogo.kind).toBe('abbr'); // the NBA keeps plan #4's strategy (byte-identical)
    });
    test('team links: none until the league has team pages; the NBA unchanged', () => {
        expect([hasTeamPages('nba'), hasTeamPages('wnba')]).toEqual([true, false]);
        expect(teamHrefFromEspn({ id: '129689' }, 'wnba')).toBeNull();
        expect(teamHrefFromEspn({ id: '17' }, 'nba')).toBe('/nba/team/1610612751');
    });
});
