/**
 * G10: the v2 Team Stats "Drives" table prints the expected points of each
 * team's average drive start ("Avg Starting Field Position (EP)") under the
 * yards row, for the whole game and for every "Show only" window.
 *
 * The value is the processor's `drives[*].avg_start_ep` (python/paper_index.py
 * add_start_ep), read off the real `usage-*` fixtures through the route's own
 * `retrieveProcessedGame`.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { withoutUsageSections } from '../src/utils/usage';
import { roundNumber } from '../src/utils/misc';
import { loadGzJson, locals, parseTable, tableWithHeading } from './helpers/tables';

const FIXTURES = {
    cfb: { file: 'usage-cfb-400869270.json.gz', id: 400869270 },
    nfl: { file: 'usage-nfl-401872922.json.gz', id: 401872922 },
} as const;
type Lg = keyof typeof FIXTURES;

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const m = String(url).match(/\/(cfb|nfl)\/(\d+)\/process/);
        if (!m) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(JSON.stringify(loadGzJson(FIXTURES[m[1] as Lg].file)), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => [],
    retrieveTeamSummaries: async () => [],
    retrieveTeamSeasonInformation: async () => null,
    retrieveMatchupHistory: async () => [],
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

const LABEL = 'Avg Starting Field Position (EP)';

describe('Drives table: drive-start EP', () => {
    for (const league of Object.keys(FIXTURES) as Lg[]) {
        test(`[${league}] every window prints each team's drive-start EP`, async () => {
            const { retrieveProcessedGame } = await import('../src/resources/python');
            const g: any = await retrieveProcessedGame(FIXTURES[league].id, 30, league);
            const spans = withoutUsageSections(g.advBoxScoreSpans);
            expect(Object.keys(spans).length, 'the fixture has windows besides the whole game').toBeGreaterThan(1);
            const Section = (await import('../src/components/game/metrics/SituationalSection.svelte')).default as any;
            // the island server-renders its default ("Game") selection; each window is
            // rendered by handing its box over in that slot
            for (const [key, box] of Object.entries(spans) as [string, any][]) {
                const html = await container.renderToString(Section, {
                    props: { season: g.season.year, advBoxScoreSpans: { ...spans, all: box }, league, percentiles: [] },
                    locals: locals(league),
                });
                const { rows } = parseTable(tableWithHeading(html, 'Drives')!);
                const at = rows.findIndex((r) => r[0] === LABEL);
                expect(at, `${key}: the Drives table has the EP row`).toBeGreaterThan(0);
                expect(rows[at - 1][0], `${key}: directly under the yards row`).toBe('Avg Starting Field Position');
                if (key === 'all') expect(box.drives.every((d: any) => typeof d.avg_start_ep === 'number'), 'the payload carries it').toBe(true);
                expect(rows[at].slice(1), key).toEqual(box.drives.map((d: any) => d.avg_start_ep == null ? '—' : roundNumber(d.avg_start_ep, 2, 2)));
            }
        }, 60_000);
    }

    test('a team with no drive in a window reads as a dash, not 0.00', async () => {
        const Table = (await import('../src/components/game/metrics/TeamMetricsTable.svelte')).default as any;
        const html = await container.renderToString(Table, {
            props: { title: 'Drives', league: 'cfb', teamKey: 'pos_team', season: 2016, columns: ['drives.avg_start_ep'], useSuffix: false, decimalPoints: 2,
                box: { drives: [{ pos_team: 2117, avg_start_ep: null }, { pos_team: 197, avg_start_ep: 2.4128 }] } },
            locals: locals('cfb'),
        });
        expect(parseTable(html).rows.find((r) => r[0] === LABEL)!.slice(1)).toEqual(['—', '2.41']);
    }, 60_000);

    test('a team with no drives row under a header from another section still gets its own cell', async () => {
        const Table = (await import('../src/components/game/metrics/TeamMetricsTable.svelte')).default as any;
        const html = await container.renderToString(Table, {
            props: { title: 'Drives', league: 'cfb', teamKey: 'pos_team', season: 2016, columns: ['drives.avg_start_ep'], useSuffix: false, decimalPoints: 2,
                box: { team: [{ pos_team: 2117 }, { pos_team: 197 }], drives: [{ pos_team: 197, avg_start_ep: 2.4128 }] } },
            locals: locals('cfb'),
        });
        expect(parseTable(html).rows.find((r) => r[0] === LABEL)!.slice(1)).toEqual(['—', '2.41']);
    }, 60_000);

    test('a window where only one team has had the ball keeps both team columns on the page', async () => {
        // The real shape: 401856682 processed from its 2026-09-13 01:41Z poll (early Q3)
        // has rows for the team with the ball only, in drives / team / situational /
        // team_usage / drive_scripting, while defensive and st_team carry only the other
        // team. Rebuilt here from this fixture's own Q3 box.
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const g: any = await retrieveProcessedGame(FIXTURES.cfb.id, 30, 'cfb');
        const away = String(g.teamInfo.away.id), home = String(g.teamInfo.home.id);
        const q3 = Object.fromEntries(Object.entries(g.advBoxScoreSpans.q3).map(([k, rows]: [string, any]) => [k,
            !Array.isArray(rows) || k === 'turnover' ? rows
                : rows.filter((r: any) => String(['defensive', 'st_team'].includes(k) ? r.def_pos_team ?? r.pos_team : r.pos_team) === (['defensive', 'st_team'].includes(k) ? home : away))]));
        expect(q3.drives.map((r: any) => String(r.pos_team))).toEqual([away]);
        g.advBoxScoreSpans = { ...g.advBoxScoreSpans, all: q3 };
        const Page = (await import('../src/components/game/GamePage.astro')).default;
        const html = await container.renderToString(Page, {
            props: { id: String(FIXTURES.cfb.id), game: g, league: 'cfb' },
            request: new Request(`https://gameonpaper.com/game/${FIXTURES.cfb.id}`),
            locals: locals('cfb'),
        });
        const teamStats = html.slice(html.indexOf('id="team-stats"'), html.indexOf('id="player-stats"'));
        for (const title of ['Drives', 'Defensive', 'Special Teams']) {
            const { rows, rowHtml } = parseTable(tableWithHeading(teamStats, title)!);
            expect([...rowHtml[0].matchAll(/team-logo-(\d+)/g)].map((m) => m[1]), `${title}: both teams head it, away first`).toEqual([away, home]);
            for (const row of rows.slice(1)) expect(row, `${title}: ${row[0]}`).toHaveLength(3);
        }
        const drives = parseTable(tableWithHeading(teamStats, 'Drives')!).rows.slice(1);
        expect(drives.every((r) => r[2] === '—'), 'the team without the ball reads as dashes').toBe(true);
        expect(drives.find((r) => r[0] === LABEL)![1]).toBe(roundNumber(q3.drives[0].avg_start_ep, 2, 2));
    }, 60_000);
});
