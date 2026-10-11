import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// "Last updated" stamps, shown to every viewer: each surface stamps from its
// own table's /v1/meta ingest time, the same stamp that keys its cached rows
// (sdvCacheVersion.test.ts). Unknown renders nothing.
const h = vi.hoisted(() => ({
    datasets: {} as Record<string, string>,
    asked: [] as string[],
    teamArgs: [] as any[], playerArgs: [] as any[][], pctArgs: [] as any[][],
    // an ingest landing mid-render: each listed read of the render cannot confirm its pin
    reads: 0, moveAt: [] as number[], ingests: 0,
}));
// the stamps a fresh meta read shows after the first and second mid-render ingest
const MOVED = ['2026-09-21T06:00:00Z', '2026-09-22T06:00:00Z'];
const read = (pin: any) => { h.reads += 1; if (pin && h.moveAt.includes(h.reads)) { pin.held = false; h.ingests += 1; } return []; };
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    sdvIngestStamp: async (league: string, table: string, fresh = false) => {
        h.asked.push(`${league}.${table}${fresh ? ' (fresh)' : ''}`);
        return fresh && h.ingests ? MOVED[h.ingests - 1] : h.datasets[`${league}.${table}`];
    },
    retrieveTeamSummaries: async (req: any) => { h.teamArgs.push(req); return read(req.pin); },
    retrievePlayerSummaries: async (...a: any[]) => { h.playerArgs.push(a); return read(a[8]); },
    // each row carries the number of ingests that had landed when it was read: its version
    retrievePercentiles: async (...a: any[]) => { h.pctArgs.push(a); read(a[4]); return [{ season: 2025, pctile: a[1], EPAplay: h.ingests }]; },
}));
/** the version of each percentile row the chart island received (its serialized `value`s) */
const chartVersions = (html: string) => [...html.matchAll(/&quot;value&quot;:\[0,(\d+)\]/g)].map((m) => Number(m[1]));

const DATASETS = {
    'cfb.team_summaries': '2026-09-26T13:14:00Z',
    'cfb.passing': '2026-09-25T10:00:00Z',
    'cfb.percentiles': '2026-09-20T04:00:00Z',
    'nfl.team_summaries': '2026-10-07T15:04:56.597057+00:00',
};

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { h.datasets = { ...DATASETS }; h.reads = 0; h.moveAt = []; h.ingests = 0; for (const a of [h.asked, h.teamArgs, h.playerArgs, h.pctArgs]) a.length = 0; });

async function page(path: string, props: Record<string, unknown>, locals: Partial<App.Locals>) {
    const { default: Page } = await import(path);
    return container.renderToString(Page, { props, request: new Request('https://gameonpaper.com/'), locals: locals as App.Locals });
}
const TEAMS = '../src/components/leaderboards/TeamLeaderboardPage.astro';
const PLAYERS = '../src/components/leaderboards/PlayerLeaderboardPage.astro';
const TRENDS = '../src/components/routes/TrendsRoute.astro';
const teamProps = { season: 2025, category: 'differential', metric: 'net_adj_epa' };

describe('leaderboard freshness stamps', () => {
    test('a public viewer (no preview cookie): the team board stamps from cfb.team_summaries', async () => {
        const html = await page(TEAMS, teamProps, {});
        expect(html).toContain('Last updated: <abbr');
        expect(html).toContain('<time datetime="2026-09-26T13:14:00Z" data-freshness>Sep 26, 2026, 1:14 PM UTC</time>');
        // the no-JS text is UTC, labelled; the stamp's own script rewrites it into the viewer's zone
        expect(html).toMatch(/<script type="module" src="[^"]*FreshnessStamp\.astro\?astro&type=script/);
        expect(h.asked).toEqual(['cfb.team_summaries']);
        // the page reads the rows itself, pinned to the stamp, and the pin held
        expect(h.teamArgs).toHaveLength(1);
        expect(h.teamArgs[0].pin).toEqual({ version: '2026-09-26T13:14:00Z', held: true });
    }, 60_000);
    test('the player board stamps from its own category table', async () => {
        const html = await page(PLAYERS, { season: 2025, category: 'passing', metric: 'EPAplay' }, {});
        expect(html).toContain('<time datetime="2026-09-25T10:00:00Z" data-freshness>Sep 25, 2026, 10:00 AM UTC</time>');
        expect(h.asked).toEqual(['cfb.passing']);
        expect(h.playerArgs).toHaveLength(1);
        expect(h.playerArgs[0][8]).toEqual({ version: '2026-09-25T10:00:00Z', held: true });
    }, 60_000);
    test('the NFL team board reads the nfl key', async () => {
        const html = await page(TEAMS, teamProps, { league: 'nfl' });
        expect(html).toContain('<time datetime="2026-10-07T15:04:56.597057+00:00" data-freshness>Oct 7, 2026, 3:04 PM UTC</time>');
        expect(h.asked).toEqual(['nfl.team_summaries']);
    }, 60_000);
    test('meta does not know the table (or is down): no stamp, page still renders', async () => {
        h.datasets = {};
        const html = await page(PLAYERS, { season: 2025, category: 'rushing', metric: 'EPAplay' }, {});
        expect(html).not.toContain('Last updated:');
        expect(html).toContain('Rushing');
        expect(h.playerArgs.at(-1)![8]).toBeUndefined(); // the table reads unpinned, as today
    }, 60_000);
});

describe('national trends stamp', () => {
    test('stamp on the page and handed to the chart island for its canvas', async () => {
        const html = await page(TRENDS, { league: 'cfb' }, {});
        expect(html).toContain('<time datetime="2026-09-20T04:00:00Z" data-freshness>Sep 20, 2026, 4:00 AM UTC</time>');
        // client:only islands serialize their props; the chart receives the ISO and draws it in the viewer's zone
        expect(html).toMatch(/props="[^"]*&quot;freshness&quot;:\[0,&quot;2026-09-20T04:00:00Z&quot;\]/);
        expect(h.asked).toEqual(['cfb.percentiles']);
        // all five percentile reads share one pin, it held, and that one batch is what renders
        expect(h.pctArgs).toHaveLength(5);
        expect(new Set(h.pctArgs.map((a) => a[4])).size).toBe(1);
        expect(h.pctArgs[0][4]).toEqual({ version: '2026-09-20T04:00:00Z', held: true });
        expect(chartVersions(html)).toEqual([0, 0, 0, 0, 0]);
    }, 60_000);
});

describe('an ingest landing mid-render drops the stamp (the rows still render)', () => {
    test('team board: no stamp, and the rows the page read are the ones rendered', async () => {
        h.moveAt = [1];
        const html = await page(TEAMS, teamProps, {});
        expect(html).not.toContain('Last updated:');
        expect(html).toContain('2025 Net Team Rankings');
        expect(h.teamArgs).toHaveLength(1); // the table renders the page's rows, no second read
    }, 60_000);
    test('player board: no stamp', async () => {
        h.moveAt = [1];
        const html = await page(PLAYERS, { season: 2025, category: 'passing', metric: 'EPAplay' }, {});
        expect(html).not.toContain('Last updated:');
        expect(h.playerArgs).toHaveLength(1);
    }, 60_000);
});

describe('trends: an ingest landing mid-batch re-reads the whole batch once', () => {
    // reads 1-2 held the old version and read 3 the new one: rendering that batch would mix them
    test('read 3 moves: all five re-read under a fresh stamp, every row is the new version, stamp shown', async () => {
        h.moveAt = [3];
        const html = await page(TRENDS, { league: 'cfb' }, {});
        expect(h.asked).toEqual(['cfb.percentiles', 'cfb.percentiles (fresh)']);
        expect(h.pctArgs).toHaveLength(10);
        expect(h.pctArgs.slice(5).map((a) => a[1])).toEqual([0.01, 0.25, 0.5, 0.75, 0.99]);
        expect(new Set(h.pctArgs.slice(5).map((a) => a[4])).size).toBe(1);
        expect(h.pctArgs[5][4]).toEqual({ version: MOVED[0], held: true });
        expect(chartVersions(html)).toEqual([1, 1, 1, 1, 1]);
        expect(html).toContain(`<time datetime="${MOVED[0]}" data-freshness>Sep 21, 2026, 6:00 AM UTC</time>`);
        expect(html).toMatch(/props="[^"]*&quot;freshness&quot;:\[0,&quot;2026-09-21T06:00:00Z&quot;\]/);
    }, 60_000);
    test('the re-read moves too (read 8): its rows render, with no stamp on the page or the canvas', async () => {
        h.moveAt = [3, 8];
        const html = await page(TRENDS, { league: 'cfb' }, {});
        expect(h.pctArgs).toHaveLength(10); // one re-read, never a third batch
        expect(chartVersions(html)).toEqual([1, 1, 2, 2, 2]);
        expect(html).not.toContain('Last updated:');
        expect(html).not.toContain('&quot;freshness&quot;');
    }, 60_000);
});

describe('the trends chart draws the stamp in its canvas', () => {
    // The island has no DOM under vitest, so its Chart.js config is pinned at the source:
    // the prop is read and its subtitle reaches options.plugins (a saved image keeps it).
    test('TrendsChart reads `freshness` and hands its viewer-local time to plugins.subtitle', () => {
        const src = readFileSync(new URL('../src/components/charts/TrendsChart.svelte', import.meta.url)).toString();
        expect(src).toMatch(/const \{[^}]*\bfreshness = null\b[^}]*\} = \$props\(\);/);
        expect(src).toMatch(/plugins: \{[\s\S]*?subtitle: \{ \.\.\.freshnessSubtitle\(freshness && freshnessTime\(freshness\)\),[\s\S]*?legend:/);
    });
});
