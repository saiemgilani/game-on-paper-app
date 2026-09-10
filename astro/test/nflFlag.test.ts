import { describe, expect, test, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

// The NFL surface sits behind the 'nfl' feature flag (utils/features.ts):
// middleware turns any /nfl path into the site's 404 unless the viewer holds
// the preview cookie; the header offers the switch into the NFL only to such a
// viewer. Promotion is 'preview' -> 'on' and nothing else.
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';

async function run(path: string, cookie: string | null) {
    const locals: Record<string, unknown> = {};
    let rewrittenTo: string | undefined = 'never-called';
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`, {
            headers: cookie ? { cookie: `${PREVIEW_COOKIE}=${cookie}` } : {},
        }),
        locals,
        cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    const res = await (onRequest as any)(ctx, async (to?: string) => { rewrittenTo = to; return new Response('ok'); });
    return { locals, res, rewrittenTo };
}

describe('the nfl flag', () => {
    test('is a preview feature until launch', () => {
        expect(FLAGS['nfl']).toBe('preview');
        expect(isFeatureEnabled('nfl', {})).toBe(false);
        expect(isFeatureEnabled('nfl', { preview: true })).toBe(true);
    });

    test('a public viewer gets the 404 for every /nfl path, and only those', async () => {
        for (const p of ['/nfl', '/nfl/', '/nfl/year/2025/teams/tendencies', '/nfl/game/401772944?span=q3']) {
            expect((await run(p, null)).rewrittenTo, p).toBe('/404');
        }
        // the cfb site is untouched, and a path that merely starts with the letters is not the namespace
        for (const p of ['/', '/year/2025/teams/differential', '/game/401752746', '/nflx']) {
            expect((await run(p, null)).rewrittenTo, p).toBeUndefined();
        }
    });

    test('the preview cookie on the public URL renders the NFL, uncacheable', async () => {
        const { locals, res, rewrittenTo } = await run('/nfl/year/2025/teams/tendencies', await mintPreviewCookie('test-secret'));
        expect(locals.preview).toBe(true);
        expect(rewrittenTo).toBeUndefined();
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    test('/preview/nfl/... composes: the strip happens first, then the gate admits the cookie holder', async () => {
        const { rewrittenTo } = await run('/preview/nfl/year/2025/teams/luck?sort=x', await mintPreviewCookie('test-secret'));
        expect(rewrittenTo).toBe('/nfl/year/2025/teams/luck?sort=x');
        // without the cookie the preview surface bounces to the public path (which then 404s)
        const bounced = await run('/preview/nfl', null);
        expect(bounced.res.status).toBe(302);
        expect(bounced.res.headers.get('Location')).toBe('/nfl');
    });

    test('the header offers the switch into the NFL only to a viewer the flag admits', async () => {
        const container = await AstroContainer.create();
        const { default: Header } = await import('../src/components/Header.astro');
        const req = new Request('https://gameonpaper.com/');
        const pub = await container.renderToString(Header, { request: req, locals: {} });
        expect(pub).not.toContain('league-switch');
        expect(pub).not.toContain('href="/nfl"');
        const prev = await container.renderToString(Header, { request: req, locals: { preview: true } });
        expect(prev).toContain('league-switch');
        expect(prev).toContain('href="/nfl"');
        // on the NFL side (already admitted) the switch back to CFB is always there
        const nfl = await container.renderToString(Header, { request: new Request('https://gameonpaper.com/nfl'), locals: { league: 'nfl' } });
        expect(nfl).toMatch(/league-switch[^>]*href="\/"|href="\/"[^>]*league-switch/);
    }, 30_000);
});
