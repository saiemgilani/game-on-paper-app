import { beforeEach, describe, expect, test, vi } from 'vitest';

// S15 stat-threshold search: the filter whitelist, the REQUEST contract against F11's
// player_seasons_wide, and the 'stat-search' flag (off: 404, no header entry).
const seen: string[] = [];
const signals: (AbortSignal | undefined)[] = [];
const ok = () => new Response(JSON.stringify({ data: [{ season: 2018 }] }), { status: 200 });
let respond: () => Response = ok;
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/v1/meta')) return new Response('{}', { status: 200 });
        seen.push(String(url));
        signals.push(init?.signal ?? undefined);
        return respond();
    },
}));
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : 'test') }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import { FLAGS } from '../src/utils/features';
import { isStatSearchPath, parseStatFilters, statSearchQuery, STAT_FILTERS } from '../src/utils/statSearch';
import { retrievePlayerSeasonsWide } from '../src/resources/sdv';
import { loadStatSearch, STAT_SEARCH_CACHE } from '../src/routes/statSearch';
import Header from '../src/components/Header.astro';

beforeEach(() => { seen.length = 0; signals.length = 0; respond = ok; });

function astro(path: string) {
    const cache: unknown[] = [];
    const headers = new Headers();
    const a: any = { url: new URL(`https://gameonpaper.com${path}`), locals: {}, response: { headers }, cache: { set: (c: unknown) => cache.push(c) } };
    return { a, cache, headers };
}

describe('parseStatFilters', () => {
    test('keeps whitelisted keys with finite non-negative numbers, in whitelist order', () => {
        const f = parseStatFilters(new URLSearchParams('rush_yards=1000&pass_yards=3000&rec=0'));
        expect(f).toEqual({ pass_yards: 3000, rush_yards: 1000, rec: 0 });
        expect(Object.keys(f)).toEqual(['pass_yards', 'rush_yards', 'rec']);
    });

    test('drops unknown keys, blanks, negatives, non-numbers and infinities', () => {
        expect(parseStatFilters(new URLSearchParams(
            'bogus=5&pass_epa=10&season=2020&pass_yards=&rush_yards=-1&rec_yards=abc&rec_td=Infinity&pass_td=1e999&rush_td=%20',
        ))).toEqual({});
    });

    test('a threshold is a whole number of at most six digits; any other spelling is dropped', () => {
        expect(parseStatFilters(new URLSearchParams('pass_yards=%203000%20&rush_yards=007&rec=999999'))).toEqual({ pass_yards: 3000, rush_yards: 7, rec: 999999 });
        for (const v of ['1e3', '1e21', '0x10', '0b11', '0o7', '1.5', '%2B5', '-0', '1,000', '1 000', '1000000', 'NaN', '3000;DROP', '1%26limit%3D9999']) {
            expect(parseStatFilters(new URLSearchParams(`pass_yards=${v}`)), v).toEqual({});
        }
    });

    test('injection: only whitelisted columns and __gte ever reach the API, with the 200 cap fixed', async () => {
        const { a } = astro('/search/seasons?pass_yards=3000&pass_yards__lte=1&pass_yards__gte=0&order=player_name&limit=100000&offset=5'
            + '&select=*&rush_yards[]=9&Rush_Yards=9&rec_yards=1%26limit%3D9999&pass_td=1%26order%3D-games&season=2020');
        await loadStatSearch(a, 'cfb');
        expect(seen).toHaveLength(1);
        const u = new URL(seen[0]);
        // exactly the parsed filter, the sort and the cap: nothing from the query string is forwarded as-is
        expect([...u.searchParams.entries()]).toEqual([['pass_yards__gte', '3000'], ['order', '-pass_yards'], ['limit', '200']]);
    });

    test('the whitelist is F11 columns only', () => {
        // checked against the live table 2026-11-02; an unknown column is IGNORED by the API, not rejected
        expect(Object.keys(STAT_FILTERS)).toEqual(['pass_yards', 'pass_td', 'rush_yards', 'rush_td', 'rec', 'rec_yards', 'rec_td', 'scrimmage_yards']);
    });
});

describe('the read', () => {
    test('one <col>__gte per filter, limit 200, ordered by the first filter', () => {
        const q = statSearchQuery({ pass_yards: 3000, rush_yards: 1000 });
        expect(q).toEqual({ pass_yards__gte: '3000', rush_yards__gte: '1000', order: '-pass_yards', limit: '200' });
    });

    test('reads the league table once, bounded by a timeout', async () => {
        const rows = await retrievePlayerSeasonsWide({ filters: { pass_yards: 3000, rush_yards: 1000 }, league: 'nfl' });
        expect(rows).toEqual([{ season: 2018 }]);
        expect(seen).toHaveLength(1);
        const u = new URL(seen[0]);
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/nfl/player_seasons_wide');
        expect([...u.searchParams.keys()].filter((k) => k.endsWith('__gte'))).toEqual(['pass_yards__gte', 'rush_yards__gte']);
        expect(u.searchParams.get('limit')).toBe('200');
        expect(u.searchParams.get('order')).toBe('-pass_yards');
        expect(signals[0]).toBeInstanceOf(AbortSignal);
    });

    test('a failed read is null, not an empty list', async () => {
        respond = () => new Response('boom', { status: 500 });
        expect(await retrievePlayerSeasonsWide({ filters: { rec: 100 }, league: 'cfb' })).toBeNull();
    });
});

describe('loadStatSearch', () => {

    test('no filters: the empty form, no read, cacheable', async () => {
        const { a, cache } = astro('/search/seasons?bogus=1');
        expect(await loadStatSearch(a, 'cfb')).toEqual({ filters: {}, rows: undefined });
        expect(seen).toHaveLength(0);
        expect(cache).toEqual([STAT_SEARCH_CACHE]);
    });

    test('a failed read is never cached', async () => {
        respond = () => new Response('boom', { status: 503 });
        const { a, cache, headers } = astro('/nfl/search/seasons?pass_yards=3000');
        const r = await loadStatSearch(a, 'nfl');
        expect(r.rows).toBeNull();
        expect(a.locals.league).toBe('nfl');
        expect(cache).toEqual([false]);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

describe('the stat-search flag', () => {
    async function run(path: string, cookie: string | null) {
        let rewrittenTo: string | undefined = 'never-called';
        const ctx: any = {
            request: new Request(`https://gameonpaper.com${path}`, { headers: cookie ? { cookie: `${PREVIEW_COOKIE}=${cookie}` } : {} }),
            locals: {},
            cache: { set: () => {} },
            redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
        };
        await (onRequest as any)(ctx, async (to?: string) => { rewrittenTo = to; return new Response('ok'); });
        return rewrittenTo;
    }

    test('is a preview flag', () => { expect(FLAGS['stat-search']).toBe('preview'); });

    test('isStatSearchPath matches both leagues, segment-exact', () => {
        for (const p of ['/search/seasons', '/search/seasons/', '/nfl/search/seasons']) expect(isStatSearchPath(p), p).toBe(true);
        for (const p of ['/search', '/search/seasonsx', '/nba/search/seasons', '/players/123', '/']) expect(isStatSearchPath(p), p).toBe(false);
    });

    test('off: the page is the 404; preview cookie: it renders', async () => {
        expect(await run('/search/seasons?pass_yards=3000', null)).toBe('/404');
        const cookie = await mintPreviewCookie('test-secret');
        expect(await run('/search/seasons?pass_yards=3000', cookie)).not.toBe('/404');
    });

    test('the Tools entry renders only behind the flag', async () => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const at = (preview: boolean, lg: 'cfb' | 'nfl') => container.renderToString(Header, {
            request: new Request(`https://gameonpaper.com${lg === 'nfl' ? '/nfl' : ''}/`), locals: { league: lg, preview } as any,
        });
        expect(await at(false, 'cfb')).not.toContain('/search/seasons');
        expect(await at(true, 'cfb')).toContain('href="/search/seasons"');
        expect(await at(true, 'nfl')).toContain('href="/nfl/search/seasons"');
    }, 60_000);
});
