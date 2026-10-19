import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// 'team-season-bands' on National Trends (Akshay, #329): a metric team_summaries carries draws its boxes from
// the team-SEASON distribution, the same read the team profile uses. A ladder-only metric, or no bands, keeps the
// five team-GAME ladder reads. Fixture: the live nfl route's body, trimmed (test/fixtures/README.md).
const BODY = JSON.parse(readFileSync(new URL('./fixtures/team-season-percentiles-nfl.json', import.meta.url)).toString());
const META = 'https://data.sportsdataverse.org/v1/meta';
const STAMPS = { 'nfl.team_summaries': '2026-10-18T09:00:00Z', 'nfl.percentiles': '2026-10-17T04:00:00Z' };

const net = vi.hoisted(() => ({ seen: [] as string[], status: 200, ladder: [] as number[] }));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        net.seen.push(String(url));
        if (String(url) === META) return new Response(JSON.stringify({ datasets: STAMPS }), { status: 200 });
        if (net.status !== 200) return new Response(JSON.stringify({ detail: 'no season' }), { status: net.status });
        return new Response(JSON.stringify(BODY), { status: 200 });
    },
}));
vi.mock('cloudflare:workers', () => {
    const kv = { get: async () => null, put: async () => {}, delete: async () => {} };
    return { env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? kv : undefined) }) };
});
// the ladder reads; retrieveTeamSeasonPercentiles stays real (served the fixture above)
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async (_s: unknown, p: number) => { net.ladder.push(p); return [{ season: 2024, pctile: p, EPAplay: 9, GEI: 9 }]; },
}));

beforeEach(() => { net.seen.length = 0; net.ladder.length = 0; net.status = 200; });

// the chart island's `percentiles` and `freshness` props ([type, value] pairs once Astro serialises them)
async function render(sort: string, preview: boolean) {
    const locals = (preview ? { preview: true } : {}) as App.Locals;
    const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    const { default: Route } = await import('../src/components/routes/TrendsRoute.astro');
    const html = await container.renderToString(Route, { props: { league: 'nfl' }, request: new Request(`https://gameonpaper.com/nfl/charts/trends?sort=${sort}`), locals });
    const tag = [...html.matchAll(/<astro-island\b[^>]*>/g)].map(m => m[0]).find(t => t.includes('/TrendsChart.svelte"'))!;
    const props = JSON.parse(tag.match(/\sprops="([^"]*)"/)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const points = (props.percentiles[1] as [number, Record<string, [number, number]>][]).map(([, p]) => ({ season: p.season[1], pctile: p.pctile[1], value: p.value[1] }));
    return { points, freshness: props.freshness?.[1] };
}
const at2024 = (points: { season: number, value: number }[]) => points.filter(p => p.season === 2024).map(p => p.value);
const bandRead = () => net.seen.filter(u => u.endsWith('/v1/nfl/team_summaries/percentiles'));

describe('National Trends with team-season-bands', () => {
    test('EPA/Play: boxes are the live 2024 EPAplay_off team-season points, from one read, stamped from team_summaries', async () => {
        const { points, freshness } = await render('EPAplay', true);
        expect(net.ladder).toEqual([]);
        expect(bandRead()).toHaveLength(1);
        expect(at2024(points)).toEqual([-0.1764, -0.0533, -0.0036, 0.0686, 0.2041]);
        expect(new Set(points.map(p => p.season))).toEqual(new Set([2023, 2024, 2025]));
        expect(freshness).toBe(STAMPS['nfl.team_summaries']);
    }, 60_000);

    test('a renamed metric maps to its team_summaries column (pass_success -> success_off_pass)', async () => {
        const { points } = await render('pass_success', true);
        expect(at2024(points)).toEqual([0.3873, 0.429, 0.4672, 0.4947, 0.5427]);
    }, 60_000);

    test('a ladder-only metric (GEI) keeps the five game-ladder reads, and skips the band read', async () => {
        const { points, freshness } = await render('GEI', true);
        expect(bandRead()).toEqual([]);
        expect(net.ladder).toEqual([0.01, 0.25, 0.5, 0.75, 0.99]);
        expect(at2024(points)).toEqual([9, 9, 9, 9, 9]);
        expect(freshness).toBe(STAMPS['nfl.percentiles']);
    }, 60_000);

    test('no bands (a 404): falls back to the game ladder', async () => {
        net.status = 404;
        const { points } = await render('EPAplay', true);
        expect(bandRead()).toHaveLength(1);
        expect(net.ladder).toEqual([0.01, 0.25, 0.5, 0.75, 0.99]);
        expect(at2024(points)).toEqual([9, 9, 9, 9, 9]);
    }, 60_000);

    test('flag off: the game ladder, no band read', async () => {
        const { points } = await render('EPAplay', false);
        expect(bandRead()).toEqual([]);
        expect(net.ladder).toEqual([0.01, 0.25, 0.5, 0.75, 0.99]);
        expect(at2024(points)).toEqual([9, 9, 9, 9, 9]);
    }, 60_000);
});
