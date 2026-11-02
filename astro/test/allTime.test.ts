import { beforeEach, describe, expect, test, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';

// S17 all-time player boards: the REQUEST contract (one read, no season filter,
// qualified in its own season, top 100 by the metric), the route checks, and the
// 'all-time-leaderboards' flag -- off: 404, no header entry, no sitemap entry.
const seen: string[] = [];
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (String(url).endsWith('/v1/meta')) return new Response('{}', { status: 200 });
        seen.push(String(url));
        return new Response(JSON.stringify({ data: [{ season: 2018 }] }), { status: 200 });
    },
}));
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : 'test') }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import { FLAGS } from '../src/utils/features';
import { ALL_TIME_SPAN, isAllTimePath, prepareAllTime } from '../src/routes/allTime';
import { allTimePlayerQuery, retrieveAllTimePlayerSeasons, SummaryType } from '../src/resources/sdv';
import { GET as sitemap } from '../src/pages/sitemap.xml';
import Header from '../src/components/Header.astro';

beforeEach(() => { seen.length = 0; });

describe('the all-time read', () => {
    test('no season, qualified in its own season, order by the metric, top 100', () => {
        const q = allTimePlayerQuery('passing', 'EPAplay');
        expect(q.has('season')).toBe(false);
        expect(q.get('EPAplay_rank__gte')).toBe('1');
        expect(q.get('order')).toBe('-EPAplay');
        expect(q.get('limit')).toBe('100');
    });

    test('a counting metric has no _rank column, so it qualifies on TEPA_rank', () => {
        const q = allTimePlayerQuery('passing', 'dropbacks');
        expect(q.get('order')).toBe('-dropbacks');
        expect(q.get('TEPA_rank__gte')).toBe('1');
        expect(q.has('dropbacks_rank__gte')).toBe(false);
    });

    test('reads the league table once, per-league base', async () => {
        const rows = await retrieveAllTimePlayerSeasons({ category: SummaryType.RUSHING, metric: 'TEPA', league: 'nfl' });
        expect(rows).toEqual([{ season: 2018 }]);
        expect(seen).toHaveLength(1);
        const u = new URL(seen[0]);
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/nfl/rushing');
        expect(u.searchParams.has('season')).toBe(false);
        expect(u.searchParams.get('TEPA_rank__gte')).toBe('1');
    });

    test('every category in both leagues has a recorded span', () => {
        for (const lg of ['cfb', 'nfl'] as const) {
            for (const c of ['passing', 'rushing', 'receiving']) expect(ALL_TIME_SPAN[lg][c], `${lg} ${c}`).toBeGreaterThan(1990);
        }
    });
});

describe('the all-time route', () => {
    const astro = (category: string, sort?: string) => ({
        params: { category }, locals: {} as App.Locals,
        url: new URL(`https://gameonpaper.com/all-time/players/${category}${sort ? `?sort=${sort}` : ''}`),
    }) as any;

    test('an unknown category is a 404', () => {
        expect(prepareAllTime(astro('defense'), 'cfb')).toEqual({ notFound: true });
        expect(prepareAllTime(astro('toString'), 'cfb')).toEqual({ notFound: true });
    });

    test('the sort must be a column of the category, else the default', () => {
        expect(prepareAllTime(astro('rushing', 'yardsplay'), 'nfl')).toEqual({ category: 'rushing', metric: 'yardsplay' });
        expect(prepareAllTime(astro('rushing', 'dropbacks'), 'cfb')).toEqual({ category: 'rushing', metric: 'TEPA' });
        expect(prepareAllTime(astro('passing', 'constructor'), 'cfb')).toEqual({ category: 'passing', metric: 'TEPA' });
    });

    test('isAllTimePath matches both leagues, segment-exact', () => {
        for (const p of ['/all-time', '/all-time/players/passing', '/nfl/all-time/players/receiving']) expect(isAllTimePath(p), p).toBe(true);
        for (const p of ['/', '/all-timex', '/year/2025/players/passing', '/nfl', '/players/123']) expect(isAllTimePath(p), p).toBe(false);
    });
});

async function run(path: string, cookie: string | null) {
    let rewrittenTo: string | undefined = 'never-called';
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`, { headers: cookie ? { cookie: `${PREVIEW_COOKIE}=${cookie}` } : {} }),
        locals: {}, cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    await (onRequest as any)(ctx, async (to?: string) => { rewrittenTo = to; return new Response('ok'); });
    return rewrittenTo;
}

describe('the all-time-leaderboards flag', () => {
    test('is preview', () => { expect(FLAGS['all-time-leaderboards']).toBe('preview'); });

    test('a public viewer gets the 404, a preview-cookie holder the board', async () => {
        for (const p of ['/all-time/players/passing', '/all-time/players/rushing?sort=EPAplay', '/nfl/all-time/players/receiving']) {
            expect(await run(p, null), p).toBe('/404');
            expect(await run(p, await mintPreviewCookie('test-secret')), p).toBeUndefined();
        }
        expect(await run('/year/2025/players/passing', null)).toBeUndefined();
    });

    test('no header entry for a public viewer; the preview viewer gets one per league', async () => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const render = (locals: object) => container.renderToString(Header, { locals: locals as App.Locals });
        expect(await render({ league: 'cfb' })).not.toContain('/all-time/');
        expect(await render({ league: 'cfb', preview: true })).toContain('href="/all-time/players/passing"');
        expect(await render({ league: 'nfl', preview: true })).toContain('href="/nfl/all-time/players/passing"');
    }, 60_000);

    test('no sitemap entry while the flag is preview', async () => {
        const xml = await ((sitemap as any)({} as any) as Response).text();
        expect(xml).not.toContain('/all-time/');
    });
});
