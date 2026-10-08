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
});
