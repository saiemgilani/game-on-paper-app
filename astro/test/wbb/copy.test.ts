// The college copy on women's numbers (D24, D25, D29, D37), and the "linked" wording that stays true when the release leaves
// a Division I program's stats.ncaa.org shots without an ESPN team (Decision 8: four programs in 2025-26).
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { BASKETBALL, seasonLabelFor } from '../../src/basketball/config';
import { coverageNote, NCAA_USAGE_NOTE } from '../../src/basketball/dashboards';
import NbaRosterTable from '../../src/components/nba/NbaRosterTable.astro';
import NbaTeamRoute from '../../src/components/routes/NbaTeamRoute.astro';
import { fmtInt, fmtPct } from '../../src/nba/format';
import { rosterRows } from '../../src/nba/tables';
import { SC, conferenceNames, conferences, coverage, leagueContext, scheduleTeams, seasonPlayers, unlinkedPrograms } from './dashboardFixtures';

const label = (s: number) => seasonLabelFor('wbb', s);
const cov = (s: number) => coverage().find((r) => r.season === s)!;
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('the coverage note on women\'s numbers', () => {
    test('2025-26: the recorded counts and shares, "from teams linked to an ESPN Division I team"', () => {
        const c = cov(2026);
        expect(coverageNote(coverage(), 2026, label)).toBe(
            `stats.ncaa.org shot charts, 2025-26: ${fmtInt(c.source_shots)} shots, ${fmtInt(c.d1_shots)} from teams linked to an ESPN Division I team; ` +
            `${fmtInt(c.placed_shots)} placed on an ESPN game (${fmtPct(c.placed_share)} of Division I shots), ${fmtInt(c.attributed_shots)} with a named shooter ` +
            `(${fmtPct(c.attributed_share)} of placed). Team and league charts count every placed shot; player tables count shots with a named shooter.`,
        );
    });
    test('2018-19 alone gets the comparison; 2024-25 shows its low placed share and no floor sentence', () => {
        expect(coverageNote(coverage(), 2019, label)).toContain('2018-19 has 236,067 charted shots against 708,038 in 2025-26.');
        for (const s of [2020, 2021, 2022, 2023, 2024, 2025, 2026]) expect(coverageNote(coverage(), s, label), String(s)).not.toContain('charted shots against');
        const n25 = coverageNote(coverage(), 2025, label)!;
        expect(n25).toContain(`(${fmtPct(cov(2025).placed_share)} of Division I shots)`);
        expect(n25).not.toContain('floors');
        expect(coverageNote(coverage(), 2018, label)).toBeNull();
    });
    test('no sentence claims a team has no charted shots', () => {
        for (const s of [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]) expect(coverageNote(coverage(), s, label), String(s)).not.toContain('by Division I teams');
    });
});

describe('PIE hidden and USG% labelled on a WBB roster (D25)', () => {
    test('South Carolina 2025-26: no PIE column, the usage note', async () => {
        const rows = rosterRows(seasonPlayers(2026), SC);
        const props = { rows, seasonQuery: '', sort: 'fga' as const, dir: 'desc' as const, mode: 'totals' as const, basePath: `/wbb/team/${SC}`, params: {}, defaults: { season: '2026' }, hidePie: true, note: NCAA_USAGE_NOTE };
        const html = await container.renderToString(NbaRosterTable, { props, locals: { league: 'wbb' } as App.Locals });
        expect(html).not.toMatch(/>PIE</);
        expect(html).toContain(NCAA_USAGE_NOTE);
        expect(html).toContain('data-sort="usgPct"');
        expect(BASKETBALL.wbb.hidePie).toBe(true);
    });
});

describe('the empty team page says "linked" (Decision 8)', () => {
    test('New Haven (2441) 2025-26: stats.ncaa.org charted 1,255 shots the release does not link; the page says so truthfully', async () => {
        expect(unlinkedPrograms().find((r) => r.season === 2026)!.members_without_shots).toContain(2441);
        vi.resetModules();
        vi.doMock('../../src/resources/nbaShots', async () => ({
            ...(await vi.importActual<typeof import('../../src/resources/nbaShots')>('../../src/resources/nbaShots')),
            retrieveSeasonPlayerRows: async () => seasonPlayers(2026),
            retrieveLeagueContextRows: async () => leagueContext(2026),
            retrieveTeamShots: async () => [],
            retrieveCoverageRows: async () => coverage(),
            retrieveConferenceRows: async () => ({ teams: conferences(2026), groups: conferenceNames(2026) }), // D43: New Haven has a 2026 row
            retrieveScheduleTeamRows: async () => scheduleTeams(2026),                                         // D47: and played 2026 games
        }));
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const astro = { params: { id: '2441' }, url: new URL('https://gameonpaper.com/wbb/team/2441'), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } } as any;
        const r: any = await prepareBasketballTeam(astro, 'wbb');
        expect([r.empty, r.dashboard, r.team.team_id]).toEqual([true, null, 2441]);
        const html = await container.renderToString(NbaTeamRoute, { props: { data: r }, request: new Request('https://gameonpaper.com/wbb/team/2441'), locals: { league: 'wbb', preview: true } as App.Locals });
        expect(html).toContain(`No stats.ncaa.org shots are linked to ${r.team.name} in 2025-26.`);
        expect(html).not.toContain('no charted shots');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        vi.doUnmock('../../src/resources/nbaShots');
    });
});
