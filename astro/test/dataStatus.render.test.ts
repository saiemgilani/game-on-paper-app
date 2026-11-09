import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { STATUS_SURFACES } from '../src/utils/freshness';

// N4: the public data-status table in /data-sources' Freshness section, behind 'data-status'.
// Each row stamps from its table's /v1/meta time (the N3 stamp); a key meta lacks reads "Unknown".
const h = vi.hoisted(() => ({ datasets: {} as Record<string, string>, asked: [] as string[] }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    sdvIngestStamp: async (league: string, table: string) => {
        h.asked.push(`${league}.${table}`);
        return h.datasets[`${league}.${table}`];
    },
}));

// the N3 test's meta (freshnessStamps.render.test.ts): no rushing key
const DATASETS = {
    'cfb.team_summaries': '2026-09-26T13:14:00Z',
    'cfb.passing': '2026-09-25T10:00:00Z',
    'cfb.percentiles': '2026-09-20T04:00:00Z',
};

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { h.datasets = { ...DATASETS }; h.asked.length = 0; });

async function render(locals: Partial<App.Locals>) {
    const { default: Page } = await import('../src/pages/data-sources.astro');
    const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/data-sources'), locals: locals as App.Locals });
    return { html: await res.text(), cacheControl: res.headers.get('Cache-Control') };
}
/** each body row's [label, last-updated cell] */
const rows = (html: string) => [...html.matchAll(/<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>(.*?)<\/td>/g)].map((m) => [m[1], m[2]]);
const H2 = ['Sources', 'Freshness', 'Known limitations'];
const h2s = (html: string) => [...html.matchAll(/<h2 class="fs-4 mt-4"[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);

describe('data-status table (flag on)', () => {
    test('one row per surface: a stamped table shows its UTC time, a missing key "Unknown", ESPN "Live from ESPN"', async () => {
        const { html, cacheControl } = await render({ preview: true });
        expect(html.match(/<table/g)).toHaveLength(1);
        // a table with real stamps takes the 5-minute edge cache; only an all-Unknown one opts out
        expect(cacheControl).not.toBe('no-store');
        const r = Object.fromEntries(rows(html));
        expect(Object.keys(r)).toEqual(STATUS_SURFACES.map((s) => s.label));
        expect(r['Team leaderboards']).toBe('<time datetime="2026-09-26T13:14:00Z" data-freshness>Sep 26, 2026, 1:14 PM UTC</time>');
        expect(r['National trends']).toBe('<time datetime="2026-09-20T04:00:00Z" data-freshness>Sep 20, 2026, 4:00 AM UTC</time>');
        expect(r['Rushing leaderboards']).toBe('Unknown');
        expect(r['Scoreboard, rankings and game pages']).toBe('Live from ESPN');
        // only cfb, and never a meta read for the ESPN row
        expect(h.asked).toEqual(STATUS_SURFACES.filter((s) => s.table).map((s) => `cfb.${s.table}`));
        // the times are rewritten into the viewer's zone by the table's own script
        expect(html).toMatch(/<script type="module" src="[^"]*DataStatusTable\.astro\?astro&type=script/);
        expect(h2s(html)).toEqual(H2);
    }, 60_000);

    test('meta down: every stamped row "Unknown", the page still renders, and it is not edge-cached', async () => {
        h.datasets = {};
        const { html, cacheControl } = await render({ preview: true });
        const cells = rows(html).map(([, c]) => c);
        expect(cells).toEqual(STATUS_SURFACES.map((s) => (s.table ? 'Unknown' : 'Live from ESPN')));
        expect(html).not.toContain('data-freshness');
        expect(cacheControl).toBe('no-store');
        expect(h2s(html)).toEqual(H2);
    }, 60_000);
});

describe('flag off (public)', () => {
    test('no table, no meta read, no script: the same three sections as the prerendered page', async () => {
        const { html, cacheControl } = await render({});
        expect(html).not.toContain('<table');
        expect(html).not.toContain('DataStatusTable');
        expect(h.asked).toEqual([]);
        expect(h2s(html)).toEqual(H2);
        expect(cacheControl).not.toBe('no-store');
    }, 60_000);
});
