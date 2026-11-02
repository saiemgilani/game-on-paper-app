import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { METRIC_YEAR } from '../src/utils/constants';

// The all-time boards (S17) rendered with real rows: the top 5 qualified passer-seasons
// by total EPA in each league, from the Data API (fixtures/all-time-passing.json).
// The SDV client is mocked; this pins the RENDER contract: the stated span, the season
// board's table with a Season column, and links into each row's own season.
const fx = JSON.parse(readFileSync(new URL('./fixtures/all-time-passing.json', import.meta.url)).toString());
let failed = false;
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    sdvIngestStamp: async () => undefined,
    retrievePlayerSummaries: async () => fx.cfb_passing,
    // the page files read through routes/allTime.ts loadAllTime
    retrieveAllTimePlayerSeasons: async ({ league }: { league: string }) => (failed ? null : league === 'nfl' ? fx.nfl_passing : fx.cfb_passing),
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

async function render(lg: 'cfb' | 'nfl', metric = 'TEPA') {
    const { default: Page } = await import('../src/components/leaderboards/AllTimePage.astro');
    return container.renderToString(Page, {
        props: { category: 'passing', metric, rows: failed ? null : lg === 'nfl' ? fx.nfl_passing : fx.cfb_passing, stamp: null },
        request: new Request(`https://gameonpaper.com${lg === 'nfl' ? '/nfl' : ''}/all-time/players/passing`),
        locals: { league: lg, preview: true },
    });
}

const bodyRows = (html: string) => html.split('<tr').filter((r) => r.includes('<td'));

describe('all-time passing, cfb', () => {
    test('states its span, first season to METRIC_YEAR', async () => {
        const html = await render('cfb');
        expect(html).toContain(`<title>All-Time College Football Passing Leaders, 2004 to ${METRIC_YEAR} | Game on Paper</title>`);
        expect(html).toContain(`<strong>Seasons covered:</strong> 2004 to ${METRIC_YEAR}`);
        expect(html).toContain('All-Time Passing Leaders');
    }, 60_000);

    test('each row links the player and team in its own season, with a Season column and the all-time position', async () => {
        const html = await render('cfb');
        const rows = bodyRows(html);
        expect(rows).toHaveLength(5);
        expect(html).toContain('href="/players/3917315?season=2018"'); // Kyler Murray
        expect(html).toContain('href="/players/3915511?season=2019"'); // Joe Burrow
        expect(html).toContain('href="/year/2018/team/201"');
        expect(html).toContain('>Season</th>');
        expect(rows[0]).toContain('<td class="text-center numeral" colspan="1">2018</td>');
        // Rk is the position on this board, not the row's rank within its own season (every row is 1st there)
        expect(rows.map((r) => r.match(/<td class="text-right numeral" colspan="1">(\d+)<\/td>/)?.[1])).toEqual(['1', '2', '3', '4', '5']);
        // the season board's shading: each row's percentile within its own season
        expect(rows[0]).toContain('hulk-bg-level');
    }, 60_000);

    test('the dropdown offers All-time, selected', async () => {
        const html = await render('cfb');
        expect(html).toMatch(/<option value="all-time" selected[^>]*>All-time<\/option>/);
    }, 60_000);
});

describe('a failed read', () => {
    test('says the board is unavailable instead of rendering an empty table', async () => {
        failed = true;
        try {
            const html = await render('cfb');
            expect(html).toContain('id="all-time-unavailable"');
            expect(bodyRows(html)).toHaveLength(0);
            expect(html).not.toContain('>Season</th>');
        } finally { failed = false; }
    }, 60_000);
});

describe('the page files', () => {
    test('read through the loader, in both leagues, and render its rows or the unavailable note', async () => {
        for (const [lg, file, path, link] of [
            ['cfb', '../src/pages/all-time/players/[category].astro', '/all-time/players/passing', 'href="/players/3917315?season=2018"'],
            ['nfl', '../src/pages/nfl/all-time/players/[category].astro', '/nfl/all-time/players/passing', 'href="/nfl/players/00-0010346?season=2013"'],
        ] as const) {
            const { default: Page } = await import(/* @vite-ignore */ file);
            const at = () => container.renderToString(Page, {
                params: { category: 'passing' }, request: new Request(`https://gameonpaper.com${path}`), locals: { preview: true } as any,
            });
            expect(await at(), lg).toContain(link);
            failed = true;
            try { expect(await at(), lg).toContain('id="all-time-unavailable"'); } finally { failed = false; }
        }
    }, 60_000);
});

describe('the season board', () => {
    test('offers the All-time option only behind the flag', async () => {
        const { default: Page } = await import('../src/components/leaderboards/PlayerLeaderboardPage.astro');
        const at = (preview: boolean) => container.renderToString(Page, {
            props: { season: 2025, category: 'passing', metric: 'TEPA' },
            request: new Request('https://gameonpaper.com/year/2025/players/passing'),
            locals: { league: 'cfb', preview },
        });
        expect(await at(false)).not.toContain('value="all-time"');
        expect(await at(true)).toMatch(/<option value="all-time"[^>]*>All-time<\/option>/);
        expect(await at(true)).not.toMatch(/<option value="all-time" selected/);
    }, 60_000);
});

describe('all-time passing, nfl', () => {
    test('the nfl span and per-season links, the same player twice', async () => {
        const html = await render('nfl');
        expect(html).toContain(`<strong>Seasons covered:</strong> 1999 to ${METRIC_YEAR}`);
        expect(html).toContain('href="/nfl/players/00-0010346?season=2013"');
        expect(html).toContain('href="/nfl/players/00-0010346?season=2004"');
        expect(html).toContain('href="/nfl/year/2004/team/11"');
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).not.toContain('FBS');
    }, 60_000);
});
