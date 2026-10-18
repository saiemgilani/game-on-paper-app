import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// 'team-season-bands' (#327): the team profile's trend boxes come from the team-SEASON distribution
// (sdv-db `team_summaries/percentiles`), read once and flattened to the five ladder points, instead of
// the five team-GAME ladder reads. Fixture: the live route's body, trimmed (test/fixtures/README.md).
const BODY = JSON.parse(readFileSync(new URL('./fixtures/team-season-percentiles-cfb.json', import.meta.url)).toString());
const META = 'https://data.sportsdataverse.org/v1/meta';
const ROUTE = 'https://data.sportsdataverse.org/v1/cfb/team_summaries/percentiles';
const STAMP = '2026-10-18T09:00:00+00:00';

const net = vi.hoisted(() => ({ seen: [] as string[], status: 200, puts: [] as string[] }));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        net.seen.push(String(url));
        if (String(url) === META) return new Response(JSON.stringify({ datasets: { 'cfb.team_summaries': STAMP } }), { status: 200 });
        if (net.status !== 200) return new Response(JSON.stringify({ detail: 'no cfb season with >= 30 team-seasons' }), { status: net.status });
        return new Response(JSON.stringify(BODY), { status: 200 });
    },
}));
vi.mock('cloudflare:workers', () => {
    const store = new Map<string, string>();
    const kv = {
        get: async (key: string, type?: string) => { const v = store.get(key); return v && type === 'json' ? JSON.parse(v) : v ?? null; },
        put: async (key: string, value: string) => { net.puts.push(key); store.set(key, value); },
        delete: async (key: string) => { store.delete(key); },
    };
    return { env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? kv : undefined) }) };
});
// the profile route's other reads; retrieveTeamSeasonPercentiles stays real (served the fixture above)
const reads = vi.hoisted(() => ({ ladder: [] as number[] }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async (_s: unknown, p: number) => { reads.ladder.push(p); return [{ season: 2024, pctile: p, EPAplay: 0.1 }]; },
    retrieveTeamSummaries: async () => [{ season: 2024, team_id: 2509, pos_team: 'Purdue', EPAplay_off: 0.05 }],
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async () => ({ id: '2509', location: 'Purdue', name: 'Boilermakers', color: 'ceb888', alternateColor: '000000' }),
}));

import { retrieveTeamSeasonPercentiles, teamSeasonBands } from '../src/resources/sdv';

beforeEach(() => { net.seen.length = 0; net.puts.length = 0; net.status = 200; reads.ladder.length = 0; });

describe('teamSeasonBands: route rows -> five ladder points', () => {
    test('2024 EPAplay_off is breaks[1|25|50|75|99] of the live row, to 4 decimals', () => {
        const rows = teamSeasonBands(BODY.data);
        expect(rows).toHaveLength(BODY.data.length);
        const row = rows.find(p => p.season === 2024 && p.metric === 'EPAplay_off')!;
        expect(row.values).toEqual([-0.1721, -0.0233, 0.0346, 0.0961, 0.2177]);
        expect(Object.keys(row).sort()).toEqual(['metric', 'season', 'values']); // no `teams`, no 101 breaks
    });

    test('a row with an unknown metric or bad breaks is dropped, the rest kept', () => {
        const row = BODY.data[0];
        const bad = [
            { ...row, metric: 'GEI' },
            { ...row, breaks: row.breaks.slice(1) },
            { ...row, breaks: row.breaks.map((b: number, i: number) => (i === 50 ? null : b)) },
            { ...row, breaks: row.breaks.map((b: number, i: number) => (i === 50 ? Number.NaN : b)) },
            { ...row, breaks: [...row.breaks].reverse() },
            { ...row, season: '2024' },
            null,
        ];
        expect(teamSeasonBands([...bad, row])).toHaveLength(1);
        expect(teamSeasonBands({ error: 'x' })).toEqual([]);
    });
});

describe('retrieveTeamSeasonPercentiles', () => {
    test('one read, cached under the team_summaries ingest stamp', async () => {
        const rows = await retrieveTeamSeasonPercentiles('cfb');
        expect(rows).toHaveLength(BODY.data.length);
        expect(net.seen.filter(u => u !== META)).toEqual([ROUTE]);
        // the pinned read confirmed its stamp against team_summaries' meta entry, so it was stored
        expect(net.puts.filter(k => !k.startsWith('sdv-meta'))).toHaveLength(1);
        await retrieveTeamSeasonPercentiles('cfb');
        expect(net.seen.filter(u => u !== META)).toHaveLength(1);
    });

    test('a 404 (no season with enough teams) is no bands', async () => {
        net.status = 404;
        vi.resetModules();
        const sdv = await import('../src/resources/sdv');
        expect(await sdv.retrieveTeamSeasonPercentiles('nfl')).toEqual([]);
    });
});

// Astro serialises island props as [type, value] pairs; only the top-level keys matter here
const islandProps = (html: string): Record<string, unknown> => {
    const tag = [...html.matchAll(/<astro-island\b[^>]*>/g)].map(m => m[0]).find(t => t.includes('/TeamTrendsChart.svelte"'))!;
    return JSON.parse(tag.match(/\sprops="([^"]*)"/)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
};

describe('team profile route', () => {
    async function render(preview: boolean) {
        const locals = (preview ? { preview: true } : {}) as App.Locals;
        const { loadTeamProfile } = await import('../src/routes/teamProfile');
        const data = await loadTeamProfile({ params: { id: '2509' }, locals, cache: { set: () => {} } } as any, 'cfb');
        if ('notFound' in data) throw new Error('not found');
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: Route } = await import('../src/components/routes/TeamProfileRoute.astro');
        const html = await container.renderToString(Route, { props: { ...data }, request: new Request('https://gameonpaper.com/team/2509'), locals });
        return { data, props: islandProps(html) };
    }

    test('flag off: the five team-game ladder reads, and the island gets no seasonBands prop', async () => {
        const { data, props } = await render(false);
        expect(reads.ladder).toEqual([0.01, 0.25, 0.5, 0.75, 0.99]);
        expect(net.seen.filter(u => u.includes('team_summaries/percentiles'))).toEqual([]);
        expect(data.seasonBands).toBe(false);
        expect(Object.keys(props)).not.toContain('seasonBands');
    });

    test('flag on: one team-season read instead, and the island is told', async () => {
        const { data, props } = await render(true);
        expect(reads.ladder).toEqual([]);
        expect(data.seasonBands).toBe(true);
        expect(data.percentiles).toHaveLength(BODY.data.length);
        expect(props.seasonBands).toEqual([0, true]);
    });
});
