import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// "Last updated" stamps (flag `freshness-stamps`): each surface stamps from its
// own table's /v1/meta ingest time, the same stamp that keys its cached rows
// (sdvCacheVersion.test.ts). Unknown renders nothing, and public renders do not
// change at all.
const h = vi.hoisted(() => ({
    datasets: {} as Record<string, string>,
    asked: [] as string[],
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    sdvIngestStamp: async (league: string, table: string) => { h.asked.push(`${league}.${table}`); return h.datasets[`${league}.${table}`]; },
    retrieveTeamSummaries: async () => [],
    retrievePlayerSummaries: async () => [],
    retrievePercentiles: async () => [],
}));

const DATASETS = {
    'cfb.team_summaries': '2026-09-26T13:14:00Z',
    'cfb.passing': '2026-09-25T10:00:00Z',
    'cfb.percentiles': '2026-09-20T04:00:00Z',
    'nfl.team_summaries': '2026-10-07T15:04:56.597057+00:00',
};

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { h.datasets = { ...DATASETS }; h.asked.length = 0; });

async function page(path: string, props: Record<string, unknown>, locals: Partial<App.Locals>) {
    const { default: Page } = await import(path);
    return container.renderToString(Page, { props, request: new Request('https://gameonpaper.com/'), locals: locals as App.Locals });
}
const TEAMS = '../src/components/leaderboards/TeamLeaderboardPage.astro';
const PLAYERS = '../src/components/leaderboards/PlayerLeaderboardPage.astro';
const TRENDS = '../src/components/routes/TrendsRoute.astro';
const teamProps = { season: 2025, category: 'differential', metric: 'net_adj_epa' };

describe('leaderboard freshness stamps', () => {
    test('preview: the team board stamps from cfb.team_summaries', async () => {
        const html = await page(TEAMS, teamProps, { preview: true });
        expect(html).toContain('Last updated: <abbr');
        expect(html).toContain('<time datetime="2026-09-26T13:14:00Z">Sep 26, 2026, 9:14 AM ET</time>');
        expect(h.asked).toEqual(['cfb.team_summaries']);
    }, 60_000);
    test('preview: the player board stamps from its own category table', async () => {
        const html = await page(PLAYERS, { season: 2025, category: 'passing', metric: 'EPAplay' }, { preview: true });
        expect(html).toContain('<time datetime="2026-09-25T10:00:00Z">Sep 25, 2026, 6:00 AM ET</time>');
        expect(h.asked).toEqual(['cfb.passing']);
    }, 60_000);
    test('preview: the NFL team board reads the nfl key', async () => {
        const html = await page(TEAMS, teamProps, { preview: true, league: 'nfl' });
        expect(html).toContain('<time datetime="2026-10-07T15:04:56.597057+00:00">Oct 7, 2026, 11:04 AM ET</time>');
        expect(h.asked).toEqual(['nfl.team_summaries']);
    }, 60_000);
    test('meta does not know the table (or is down): no stamp, page still renders', async () => {
        h.datasets = {};
        const html = await page(PLAYERS, { season: 2025, category: 'rushing', metric: 'EPAplay' }, { preview: true });
        expect(html).not.toContain('Last updated:');
        expect(html).toContain('Rushing');
    }, 60_000);
    test('public: no stamp, and meta is not even asked', async () => {
        const html = await page(TEAMS, teamProps, {});
        expect(html).not.toContain('Last updated:');
        expect(h.asked).toEqual([]);
    }, 60_000);
});

describe('national trends stamp', () => {
    test('preview: stamp on the page and handed to the chart island for its canvas', async () => {
        const html = await page(TRENDS, { league: 'cfb' }, { preview: true });
        expect(html).toContain('<time datetime="2026-09-20T04:00:00Z">Sep 20, 2026, 12:00 AM ET</time>');
        // client:only islands serialize their props; the chart receives the stamp text
        expect(html).toMatch(/props="[^"]*&quot;freshness&quot;:\[0,&quot;Sep 20, 2026, 12:00 AM ET&quot;\]/);
        expect(h.asked).toEqual(['cfb.percentiles']);
    }, 60_000);
    test('public: no stamp, and the island props carry no freshness key', async () => {
        const html = await page(TRENDS, { league: 'cfb' }, {});
        expect(html).not.toContain('Last updated:');
        expect(html).not.toContain('&quot;freshness&quot;');
        expect(h.asked).toEqual([]);
    }, 60_000);
});
