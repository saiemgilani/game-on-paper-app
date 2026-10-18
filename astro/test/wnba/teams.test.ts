import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { WNBA_DEFUNCT, WNBA_FORMER_NAMES, WNBA_TEAMS, wnbaTeamByEspnId, wnbaTeamById } from '../../src/nba/data/wnbaTeams';

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
