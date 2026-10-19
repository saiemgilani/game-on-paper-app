// astro/test/mbb/copy.test.ts
// The college copy states recorded facts only (D37): the season's shot_coverage numbers, the scope, the box-score USG%,
// no PIE. The NBA's copy is untouched (the byte-identity gate covers its pages; the components here are checked directly).
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { seasonLabelFor } from '../../src/basketball/config';
import { coverageNote, NCAA_USAGE_NOTE } from '../../src/basketball/dashboards';
import NbaRankLists from '../../src/components/nba/NbaRankLists.astro';
import NbaRosterTable from '../../src/components/nba/NbaRosterTable.astro';
import { fmtInt, fmtPct } from '../../src/nba/format';
import { rosterRows } from '../../src/nba/tables';
import { apiSeasonPlayerRows } from '../nba/rows';
import {
    TEX, conferenceNames, conferences, coverage, leagueContext, p26, player2026Games, player2026Seasons, player2026Shots, scheduleTeams, seasonPlayers, texShots,
} from './dashboardFixtures';

const label = (s: number) => seasonLabelFor('mbb', s);
const cov = (s: number) => coverage().find((r) => r.season === s)!;
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

describe('the coverage note (D24, D29, D37)', () => {
    test('2025-26: the five recorded counts and the two shares, nothing else', () => {
        const c = cov(2026);
        expect(coverageNote(coverage(), 2026, label)).toBe(
            `stats.ncaa.org shot charts, 2025-26: ${fmtInt(c.source_shots)} shots, ${fmtInt(c.d1_shots)} from teams linked to an ESPN Division I team; ` +
            `${fmtInt(c.placed_shots)} placed on an ESPN game (${fmtPct(c.placed_share)} of Division I shots), ${fmtInt(c.attributed_shots)} with a named shooter ` +
            `(${fmtPct(c.attributed_share)} of placed). Team and league charts count every placed shot; player tables count shots with a named shooter.`,
        );
    });
    test('2018-19: the partial charting is told by its numbers', () => {
        expect(coverageNote(coverage(), 2019, label)).toContain('2018-19 has 257,291 charted shots against 740,861 in 2025-26.');
        for (const s of [2020, 2021, 2022, 2023, 2024, 2025, 2026]) expect(coverageNote(coverage(), s, label), String(s)).not.toContain('charted shots against');
    });
    test('a season under the floors says so (a copy of the real 2026 row with meets_floor false)', () => {
        const rows = coverage().map((r) => (r.season === 2026 ? { ...r, meets_floor: false } : r));
        expect(coverageNote(rows, 2026, label)).toMatch(/This season is under the dashboards' coverage floors \(94% placed, 95% attributed\)\.$/);
        expect(coverageNote(coverage(), 2026, label)).not.toContain('floors');
    });
    test('meets_floor as the Data API string form: "True"/"true" meet the floors, "False"/"false" do not', () => {
        const as = (v: string) => coverage().map((r) => (r.season === 2026 ? { ...r, meets_floor: v } : r));
        for (const v of ['True', 'true']) expect(coverageNote(as(v), 2026, label), v).toBe(coverageNote(coverage(), 2026, label));
        for (const v of ['False', 'false']) expect(coverageNote(as(v), 2026, label), v).toMatch(/under the dashboards' coverage floors/);
    });
    test('no row for the season: no note', () => {
        expect(coverageNote(coverage(), 2018, label)).toBeNull();
        expect(coverageNote([], 2026, label)).toBeNull();
    });
});

describe('PIE hidden and USG% labelled (D25)', () => {
    const rows = rosterRows(seasonPlayers(2026), TEX);
    const props = { rows, seasonQuery: '', sort: 'fga' as const, dir: 'desc' as const, mode: 'totals' as const, basePath: `/mbb/team/${TEX}`, params: {}, defaults: { season: '2026' } };
    test('the college roster table: no PIE column, no PIE in the footnote, the usage note', async () => {
        const html = await container.renderToString(NbaRosterTable, { props: { ...props, hidePie: true, note: NCAA_USAGE_NOTE }, locals: { league: 'mbb' } as App.Locals });
        expect(html).not.toMatch(/>PIE</);
        expect(html).not.toContain('data-sort="pie"');
        expect(html).toContain('GP, MIN, FGA/g, TS% and USG% are season totals across teams');
        expect(html).toContain(NCAA_USAGE_NOTE);
        expect(html).toContain('data-sort="usgPct"');
    });
    test('without the flag the table is the NBA one: PIE and its footnote', async () => {
        const html = await container.renderToString(NbaRosterTable, { props, locals: { league: 'mbb' } as App.Locals });
        expect(html).toMatch(/>PIE</);
        expect(html).toContain('TS%, USG% and PIE are season totals');
        expect(html).not.toContain(NCAA_USAGE_NOTE);
    });
    test('the usage note names its method and no number', () => {
        expect(NCAA_USAGE_NOTE).toBe('USG% here is box-score usage from ESPN box scores (field-goal attempts, free-throw attempts, turnovers and minutes); PIE is not shown because the box-score formula does not reproduce it.');
        expect(NCAA_USAGE_NOTE).not.toMatch(/\d/);
    });
    test('the team loader ignores ?sort=pie for a league that hides PIE', async () => {
        vi.resetModules();
        vi.doMock('../../src/resources/nbaShots', async () => ({
            ...(await vi.importActual<typeof import('../../src/resources/nbaShots')>('../../src/resources/nbaShots')),
            retrieveSeasonPlayerRows: async () => seasonPlayers(2026),
            retrieveLeagueContextRows: async () => leagueContext(2026),
            retrieveTeamShots: async () => texShots(2026),
            retrieveCoverageRows: async () => coverage(),
            retrieveConferenceRows: async () => ({ teams: [], groups: [] }),
        }));
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const astro = { params: { id: String(TEX) }, url: new URL(`https://gameonpaper.com/mbb/team/${TEX}?sort=pie`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } } as any;
        const r: any = await prepareBasketballTeam(astro, 'mbb');
        expect(r.sort).toBe('fga');
        expect(r.coverage).toBe(coverageNote(coverage(), 2026, label));
        vi.doUnmock('../../src/resources/nbaShots');
    });
});

describe('the rank lists name the scope', () => {
    test('college: this regular season + postseason; default: this regular season', async () => {
        const base = { ranks: [], personId: 1, seasonQuery: '' };
        const college = await container.renderToString(NbaRankLists, { props: { ...base, scope: 'regular season + postseason' }, locals: { league: 'mbb' } as App.Locals });
        expect(college).toContain('field-goal attempts this regular season + postseason;');
        const nba = await container.renderToString(NbaRankLists, { props: base, locals: { league: 'nba' } as App.Locals });
        expect(nba).toContain('field-goal attempts this regular season;');
    });
});

// The coverage read is decorative (D24): a failed read renders the page without the note and must never be cached.
describe('the coverage read failing', () => {
    const fakeAstro = (path: string) => {
        const cache: unknown[] = [];
        const headers = new Headers();
        return { astro: { params: { id: String(TEX) }, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
    };
    const state = { fail: false, calls: 0 };
    async function loaders() {
        vi.resetModules();
        vi.doMock('../../src/resources/nbaShots', async () => ({
            ...(await vi.importActual<typeof import('../../src/resources/nbaShots')>('../../src/resources/nbaShots')),
            retrieveSeasonPlayerRows: async (_s: number, league: string) => (league === 'nba' ? apiSeasonPlayerRows() : seasonPlayers(2026)),
            retrieveLeagueContextRows: async () => leagueContext(2026),
            retrieveTeamShots: async () => texShots(2026),
            retrieveConferenceRows: async () => ({ teams: conferences(2026), groups: conferenceNames(2026) }),
            retrieveScheduleTeamRows: async () => scheduleTeams(2026),
            retrieveCoverageRows: async () => { state.calls++; if (state.fail) throw new Error('down'); return coverage(); },
        }));
        // one import at a time: concurrent dynamic imports while the async mock factory runs can bind the actual nbaShots
        const { readCoverageNote } = await import('../../src/routes/basketball/season');
        const { prepareBasketballTeams } = await import('../../src/routes/basketball/teams');
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        return { readCoverageNote, prepareBasketballTeams, prepareBasketballTeam };
    }
    test('readCoverageNote: undefined on a failed read; the teams and team loaders render without the note, uncacheable', async () => {
        const { readCoverageNote, prepareBasketballTeams, prepareBasketballTeam } = await loaders();
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            for (const [name, run] of [['teams', prepareBasketballTeams], ['team', prepareBasketballTeam]] as const) {
                state.fail = false;
                const ok = fakeAstro(`/mbb/${name}`);
                const r: any = await run(ok.astro, 'mbb');
                expect(r.coverage, name).toBe(coverageNote(coverage(), 2026, label));
                expect(ok.cache, name).not.toContain(false);   // the control: a good read leaves the page cacheable
                expect(ok.headers.get('Cache-Control'), name).toBeNull();
                state.fail = true;
                const bad = fakeAstro(`/mbb/${name}`);
                const r2: any = await run(bad.astro, 'mbb');
                expect(r2.coverage, name).toBeNull();
                expect('unavailable' in r2 || 'notFound' in r2, name).toBe(false);
                expect(bad.cache.at(-1), name).toBe(false);
                expect(bad.headers.get('Cache-Control'), name).toBe('no-store');
            }
            expect(await readCoverageNote('mbb', 2026)).toBeUndefined();
        } finally {
            state.fail = false;
            err.mockRestore();
            vi.doUnmock('../../src/resources/nbaShots');
        }
    });
    test('the NBA never reads coverage and its params carry no coverage key', async () => {
        const { readCoverageNote, prepareBasketballTeams } = await loaders();
        state.calls = 0;
        state.fail = true;   // a read would fail: the NBA must not issue one
        try {
            expect(await readCoverageNote('nba', 2026)).toBeNull();
            const { astro, cache } = fakeAstro('/nba/teams');
            const r: any = await prepareBasketballTeams(astro, 'nba');
            expect(r.teams.length).toBe(30);
            expect('coverage' in r).toBe(false);
            expect(cache).not.toContain(false);
            expect(state.calls).toBe(0);
        } finally {
            state.fail = false;
            vi.doUnmock('../../src/resources/nbaShots');
        }
    });
});

describe('the college player page: the usage note sits with the season-stats line', () => {
    async function playerData(hasStats: boolean) {
        vi.resetModules();
        const me = p26().person_id;
        vi.doMock('../../src/resources/nbaShots', async () => ({
            ...(await vi.importActual<typeof import('../../src/resources/nbaShots')>('../../src/resources/nbaShots')),
            // a copy of the real 2026 rows; without stats, his rows read has_stats false (a player with no ESPN box row)
            retrieveSeasonPlayerRows: async () => seasonPlayers(2026).map((r) => (r.person_id === me && !hasStats ? { ...r, has_stats: false } : r)),
            retrieveLeagueContextRows: async () => leagueContext(2026),
            retrievePlayerShots: async () => player2026Shots(),
            retrievePlayerGameRows: async () => player2026Games(),
            retrievePlayerSeasons: async () => player2026Seasons().map((r) => r.season),
            retrieveCoverageRows: async () => coverage(),
        }));
        const { prepareBasketballPlayer } = await import('../../src/routes/basketball/player');
        const astro = { params: { id: String(me) }, url: new URL(`https://gameonpaper.com/mbb/players/${me}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } } as any;
        const r: any = await prepareBasketballPlayer(astro, 'mbb');
        vi.doUnmock('../../src/resources/nbaShots');
        return r;
    }
    test('with stats: the USG% line without PIE and the usage note; without: neither, the coverage note stays', async () => {
        const withStats = await playerData(true);
        const without = await playerData(false);
        // the route and its Svelte island from the module graph the renderer loads (resetModules above re-creates svelte's runtime)
        const { default: NbaPlayerRoute } = await import('../../src/components/routes/NbaPlayerRoute.astro');
        const c = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        expect(withStats.player.stats).not.toBeNull();
        const a = await c.renderToString(NbaPlayerRoute, { props: { data: withStats }, locals: { league: 'mbb' } as App.Locals });
        expect(a).toContain(NCAA_USAGE_NOTE);
        expect(a).toMatch(/USG% &middot; [\d.]+% TS%<\/p>/);
        expect(a).not.toMatch(/ PIE</);
        expect(a).toContain('id="nba-coverage"');
        expect(without.player.stats).toBeNull();
        const b = await c.renderToString(NbaPlayerRoute, { props: { data: without }, locals: { league: 'mbb' } as App.Locals });
        expect(b).not.toContain(NCAA_USAGE_NOTE);
        expect(b).not.toContain('USG%');
        expect(b).toContain('id="nba-coverage"');
    });
});
