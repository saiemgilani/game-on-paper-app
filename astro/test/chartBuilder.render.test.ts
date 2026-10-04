import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { median } from '../src/utils/chartBuilder';

// /charts/builder and its /nfl twin, rendered from real Data API rows: the cfb
// 2026 builder read (Rice has a null red-zone pass value) and the nfl 2025 top-4.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)).toString());
const ROWS: Record<string, any[]> = {
    cfb: fixture('team-summaries-cfb-2026-builder.json').data,
    nfl: fixture('nfl-summaries-2025.json').team_summaries,
};
const QUERY = {
    cfb: 'season=2026&x=red_zone_success_off_pass&y=success_off',
    nfl: 'season=2025&x=adj_off_epa&y=adj_def_epa',
} as const;
// what the builder asks the Data API for today: the two plotted columns, nothing else
const REQUEST = {
    cfb: { season: 2026, columns: ['red_zone_success_off_pass', 'success_off'], maxLookback: 2026, league: 'cfb' },
    nfl: { season: 2025, columns: ['adj_off_epa', 'adj_def_epa'], maxLookback: 2025, league: 'nfl' },
};

const feed: { calls: any[] } = { calls: [] };
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSummaries: async (req: any) => {
        feed.calls.push(req);
        return ROWS[req.league];
    },
}));

// Astro serialises each island prop as a [type, value] pair: 0 = value/object, 1 = array.
const decode = (v: any): any => {
    if (!Array.isArray(v)) return v;
    const [t, x] = v;
    if (t === 1) return x.map(decode);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, w]) => [k, decode(w)]));
    return x;
};
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const island = (html: string): Record<string, any> => {
    const tag = [...html.matchAll(/<astro-island\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes('/ChartBuilder.svelte"'))!;
    return decode([0, JSON.parse(unescape(tag.match(/\sprops="([^"]*)"/)![1]))]);
};
// island uids are random per render and component urls carry the checkout's absolute path
const ASTRO_DIR = new URL('..', import.meta.url).pathname;
const normalise = (html: string) => html.replace(/\suid="[^"]*"/g, ' uid=""').split(ASTRO_DIR).join('');
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
beforeEach(() => { feed.calls = []; });

/** What pages/{,nfl/}charts/builder.astro do: the loader (with a stub Astro, since the container has
 *  no Workers Caching), then the route component with its result spread in. */
async function render(league: 'cfb' | 'nfl', query: string, preview: boolean) {
    const url = `https://gameonpaper.com${league === 'nfl' ? '/nfl' : ''}/charts/builder?${query}`;
    const locals = (preview ? { preview: true } : {}) as App.Locals;
    const { loadChartBuilder } = await import('../src/routes/charts');
    const data = await loadChartBuilder({ url: new URL(url), locals, cache: { set: () => {} } } as any, league);
    const { default: Route } = await import('../src/components/routes/ChartBuilderRoute.astro');
    return container.renderToString(Route, { props: { ...data }, request: new Request(url), locals });
}

describe('chart-builder-v2 off: the public builder is what main renders', () => {
    // Hashes of the flag-off render of these fixtures on origin/main b5665b08,
    // before 'chart-builder-v2' existed (same test body, run there). Another PR
    // that changes the builder page moves these on purpose: re-run with
    // PRINT_GOLDEN=1 and paste. Delete this block when the flag is promoted.
    const GOLDEN = { cfb: 'e55c00998dbaeb4a', nfl: '99585fda010f1821' };

    test.each(['cfb', 'nfl'] as const)('%s: same island props, same request, same page', async (league) => {
        const html = await render(league, QUERY[league], false);
        expect(Object.keys(island(html))).toEqual(['season', 'x', 'y', 'points', 'league']);
        expect(feed.calls).toEqual([REQUEST[league]]);
        if (process.env.PRINT_GOLDEN) console.log(`GOLDEN ${league} ${sha(normalise(html))}`);
        expect(sha(normalise(html))).toBe(GOLDEN[league]);
        // the v2 parameters are not read for a public viewer
        expect(normalise(await render(league, `${QUERY[league]}&hl=SEC&mode=dots`, false))).toBe(normalise(html));
    });
});

describe('chart-builder-v2 on', () => {
    test.each(['cfb', 'nfl'] as const)('%s: v2, highlight and mode reach the island; the read is unchanged', async (league) => {
        const props = island(await render(league, `${QUERY[league]}&hl=SEC&mode=dots`, true));
        expect(props).toMatchObject({ v2: true, highlight: 'SEC', mode: 'dots' });
        expect(props.points).toHaveLength(ROWS[league].length);
        expect(feed.calls).toEqual([REQUEST[league]]);
    });

    test('an unknown mode falls back to logos, and the highlight is capped at 60 characters', async () => {
        const props = island(await render('cfb', `${QUERY.cfb}&mode=hexes&hl=${'x'.repeat(80)}`, true));
        expect(props).toMatchObject({ mode: 'logos', highlight: 'x'.repeat(60) });
    });

    test('the crosshair median over the island points skips the team with no value', async () => {
        const { points } = island(await render('cfb', QUERY.cfb, true));
        expect(points.find((p: any) => p.team_id === 242).x).toBeNull();
        expect(median(points.map((p: any) => p.x))).toBe(0.38461538461538464);
        expect(median(points.map((p: any) => p.y))).toBe((0.43621399176954734 + 0.4369369369369369) / 2);
    });
});
