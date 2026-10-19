import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { WNBA_DEFUNCT, WNBA_FORMER_NAMES, WNBA_TEAMS, wnbaEraTricode, wnbaLogoId, wnbaTeamByEspnId, wnbaTeamById } from '../../src/nba/data/wnbaTeams';
import { WNBA_HOSTED_LOGOS, WNBA_LOGO_ABBR } from '../../src/utils/league';

type Row = { espn_team_id: number; espn_display_name: string; wnba_team_id: string; wnba_team_tricode: string; first: number; last: number };
const XW: Row[] = JSON.parse(readFileSync(new URL('../fixtures/wnba/team_crosswalk_2002_2026.json', import.meta.url)).toString());
const key = (id: number | string, name: string, tri: string) => `${id}|${name}|${tri}`;

describe('the WNBA team module is the wehoop-wnba-data team crosswalk', () => {
    test('the 2026 league: 15 franchises, stats id, tricode, name and ESPN id as the crosswalk says', () => {
        const now = XW.filter((r) => r.last === 2026);
        expect(now).toHaveLength(15);
        expect(WNBA_TEAMS).toHaveLength(15);
        for (const r of now) {
            const t = wnbaTeamByEspnId(r.espn_team_id)!;
            expect([t.team_id, t.tricode, t.name, t.espn_id], r.espn_display_name).toEqual([Number(r.wnba_team_id), r.wnba_team_tricode, r.espn_display_name, r.espn_team_id]);
            expect(wnbaTeamById(t.team_id)).toBe(t);
        }
    });
    test('a relocated franchise keeps its stats id under every ESPN id it had', () => {
        for (const espn of [15, 17]) expect(wnbaTeamByEspnId(espn)!.team_id).toBe(1611661319); // Utah Starzz -> San Antonio -> Las Vegas Aces
        for (const espn of [10, 18]) expect(wnbaTeamByEspnId(espn)!.team_id).toBe(1611661323); // Orlando Miracle -> Connecticut Sun
        expect(wnbaTeamByEspnId(3)!.tricode).toBe('DAL'); // Detroit -> Tulsa -> Dallas kept ESPN id 3
    });
    test('the 2000-02 Portland Fire is not the 2026 Portland Fire, though stats.wnba.com gave both 1611661327', () => {
        expect(XW.filter((r) => r.wnba_team_id === '1611661327').map((r) => r.espn_team_id)).toEqual([12, 132052]);
        expect(wnbaTeamByEspnId(12)).toBeUndefined();
        expect(wnbaTeamByEspnId(132052)!.tricode).toBe('PDX');
    });
    test('former names and defunct franchises are exactly the crosswalk rows that are not a current team', () => {
        const current = new Set(WNBA_TEAMS.map((t) => key(t.team_id, t.name, t.tricode)));
        const past = XW.filter((r) => !current.has(key(r.wnba_team_id, r.espn_display_name, r.wnba_team_tricode)));
        expect(past).toHaveLength(13);
        const listed = [
            ...WNBA_FORMER_NAMES.map((f) => `${key(f.team_id, f.name, f.tricode)}|${f.through}`),
            ...WNBA_DEFUNCT.map((d) => `${key(d.team_id, d.name, d.tricode)}|${d.through}`),
        ];
        expect(listed.sort()).toEqual(past.map((r) => `${key(r.wnba_team_id, r.espn_display_name, r.wnba_team_tricode)}|${r.last}`).sort());
        for (const d of WNBA_DEFUNCT) {
            expect(XW.find((r) => r.espn_team_id === d.espn_id && r.espn_display_name === d.name), d.name).toBeDefined();
            expect(wnbaTeamByEspnId(d.espn_id), d.name).toBeUndefined();
        }
    });
});

describe('wnbaEraTricode: the tricode a franchise had in a season, season-first (D22 id-keyed identity)', () => {
    test('ESPN id 3 is the Detroit Shock through 2009, the Tulsa Shock through 2015, then no override (Dallas)', () => {
        expect(wnbaEraTricode(3, 2005)).toBe('DET');
        expect(wnbaEraTricode(3, 2009)).toBe('DET');
        expect(wnbaEraTricode(3, 2010)).toBe('TUL');
        expect(wnbaEraTricode(3, 2016)).toBeUndefined();
        expect(wnbaEraTricode(3, 2025)).toBeUndefined();
    });
    test('a relocated franchise under either ESPN id: San Antonio under 17, Utah under 15', () => {
        expect(wnbaEraTricode(17, 2005)).toBe('SAN');
        expect(wnbaEraTricode(15, 2002)).toBe('UTA');
        expect(wnbaEraTricode(17, 2018)).toBeUndefined();
    });
    test('Phoenix was always the Phoenix Mercury: stats.wnba.com\'s PHO never overrides ESPN\'s PHX', () => {
        for (const season of [2005, 2015, 2024, 2025]) expect(wnbaEraTricode(11, season)).toBeUndefined();
    });
    test('no override for a franchise with no former name, a folded franchise, an unknown id or an unknown season', () => {
        for (const id of [16, 9, 8]) expect(wnbaEraTricode(id, 2005)).toBeUndefined(); // WAS, NYL, MIN on the 2005-06-03 board
        expect(wnbaEraTricode(1, 2005)).toBeUndefined(); // Charlotte Sting
        expect(wnbaEraTricode(12, 2002)).toBeUndefined(); // the 2000-02 Portland Fire
        expect(wnbaEraTricode(3, null)).toBeUndefined();
    });
});

describe('wnbaLogoId: the ESPN id a logo is keyed by in a season', () => {
    test('ESPN files the 2000-02 Portland Fire under the 2026 Fire\'s 132052: through 2002 that is the old Fire, 12', () => {
        expect(wnbaLogoId(132052, 2000)).toBe('12');
        expect(wnbaLogoId('132052', 2002)).toBe('12');
        expect(wnbaLogoId(132052, 2003)).toBe('132052');
        expect(wnbaLogoId(132052, 2026)).toBe('132052');
        expect(wnbaLogoId(132052, null)).toBe('132052');
    });
    test('a relocated franchise draws its era\'s logo, by ESPN id and season (D22): every WNBA_FORMER_NAMES boundary', () => {
        // Detroit Shock -> Tulsa Shock -> Dallas Wings, all ESPN id 3
        expect([2002, 2009, 2010, 2015, 2016, 2026].map((y) => wnbaLogoId(3, y))).toEqual(['det', 'det', 'tul', 'tul', '3', '3']);
        // Utah Starzz (15; 17 if ESPN files it under the Aces) -> San Antonio Silver Stars -> San Antonio Stars -> Las Vegas Aces (17)
        expect(wnbaLogoId(15, 2002)).toBe('uta');
        expect([2002, 2003, 2013, 2014, 2017, 2018].map((y) => wnbaLogoId(17, y))).toEqual(['uta', 'sas', 'sas', 'sa', 'sa', '17']);
        // Orlando Miracle (10; 18 likewise) -> Connecticut Sun (18)
        expect(wnbaLogoId(10, 2002)).toBe('orl');
        expect([2002, 2003].map((y) => wnbaLogoId(18, y))).toEqual(['orl', '18']);
        // Phoenix's PHO row is today's name, so the id stands
        expect(wnbaLogoId(11, 2005)).toBe('11');
    });
    test('every era with a logo key resolves to exactly one source: an ESPN era file or a hosted mark', () => {
        for (const f of WNBA_FORMER_NAMES.filter((r) => r.logo)) {
            expect(Number(f.logo! in WNBA_LOGO_ABBR) + Number(f.logo! in WNBA_HOSTED_LOGOS), f.name).toBe(1);
        }
        expect(WNBA_FORMER_NAMES.filter((r) => !r.logo).map((r) => r.name)).toEqual(['Phoenix Mercury']);
    });
    test('every other id is itself, in any season; no season, the id', () => {
        for (const id of [1, 2, 7, 12, 16]) expect(wnbaLogoId(id, 2002)).toBe(String(id));
        for (const id of [3, 15, 17]) expect(wnbaLogoId(id, null)).toBe(String(id));
    });
});
