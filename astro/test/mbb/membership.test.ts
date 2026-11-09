// astro/test/mbb/membership.test.ts
// One membership rule (owner rulings D43/D47, resolution R7): a season's college members are the ids with a conference row
// that season AND >= 1 game (home or away) in that season's schedule. It drives the index, the team-page 404 and the
// sitemap's committed table; plan #11 reuses it for the women.
import { describe, expect, test } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { withSeasonMembers } from '../../src/basketball/dashboards';
import { MBB_MEMBERS_2026 } from '../../src/nba/data/mbbMembers';
import { teamsFromSeasonRows } from '../../src/nba/tables';
import { conferences, scheduleTeams, seasonPlayers } from './dashboardFixtures';

const played = (s: 2019 | 2021 | 2026) => new Set(scheduleTeams(s).flatMap((g) => [g.home_id, g.away_id]).filter((x) => x != null).map(Number));

describe('withSeasonMembers', () => {
    test('2026: 365 members, Hartford (42: in ESPN\'s core list, no conference row) out; row-derived teams kept', () => {
        const withShots = teamsFromSeasonRows(seasonPlayers(2026), 2026, 'mbb');
        const m = withSeasonMembers(withShots, conferences(2026), scheduleTeams(2026), 2026, 'mbb');
        expect(m).toHaveLength(365);
        expect(new Set(m.map((t) => t.team_id)).size).toBe(365);
        expect(m.some((t) => t.team_id === 42)).toBe(false);
        const tex = m.find((t) => t.team_id === 251)!;
        expect(tex).toBe(withShots.find((t) => t.team_id === 251)); // the row-derived object, not a module lookup
    });
    test('2021: a conference row with no game that season is not a member (the 2020-21 Ivy League)', () => {
        const noGame = conferences(2021).filter((r) => !played(2021).has(Number(r.team_id)));
        expect(noGame.length).toBeGreaterThanOrEqual(8);
        const m = withSeasonMembers([], conferences(2021), scheduleTeams(2021), 2021, 'mbb');
        for (const r of noGame) expect(m.some((t) => t.team_id === Number(r.team_id)), r.team_id).toBe(false);
        expect(m.length).toBeGreaterThan(300);
        expect(m.every((t) => played(2021).has(t.team_id))).toBe(true);
    });
    test('a member with no shots resolves through teams.inSeason; text ids are parsed behind /^\\d+$/, never cast', () => {
        const m = withSeasonMembers([], [{ team_id: '150', conference_id: 'mbb:acc' }, { team_id: 'x9', conference_id: 'mbb:sec' }], [{ home_id: 150, away_id: 9 }], 2026, 'mbb');
        expect(m).toEqual([BASKETBALL.mbb.teams.inSeason(150, 2026)]);
    });
    test('the committed current-season table is this rule over the 2026 captures (it cannot drift); NBA/WNBA carry none', () => {
        const ids = withSeasonMembers(teamsFromSeasonRows(seasonPlayers(2026), 2026, 'mbb'), conferences(2026), scheduleTeams(2026), 2026, 'mbb').map((t) => t.team_id).sort((a, b) => a - b);
        expect([...MBB_MEMBERS_2026]).toEqual(ids);
        expect(BASKETBALL.mbb.currentMembers).toEqual({ season: 2026, ids: MBB_MEMBERS_2026 });
        for (const lg of ['nba', 'wnba'] as const) expect(Object.keys(BASKETBALL[lg])).not.toContain('currentMembers');
    });
});
