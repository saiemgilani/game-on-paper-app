import { describe, expect, test, vi } from 'vitest';

// End-to-end preview chain: a minted cookie through the REAL middleware must
// set locals.preview, and an expired one must not -- silently, which is the
// on-page symptom "preview features stopped working".
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import {
    mintPreviewCookie, mintPreviewLink, verifyPreviewCookie, verifyPreviewLink,
    PREVIEW_COOKIE, PREVIEW_LINK_PARAM,
} from '../src/utils/preview';

async function run(cookie: string | null) {
    const locals: Record<string, unknown> = {};
    const ctx: any = {
        request: new Request('https://gameonpaper.com/game/401752746', {
            headers: cookie ? { cookie: `${PREVIEW_COOKIE}=${cookie}` } : {},
        }),
        locals,
        cache: { set: () => {} },
        redirect: (l: string) => new Response(null, { status: 302, headers: { Location: l } }),
    };
    const res = await (onRequest as any)(ctx, async () => new Response('ok'));
    return { locals, res };
}

describe('the preview chain end to end', () => {
    test('a valid cookie sets locals.preview and the response is no-store', async () => {
        const { locals, res } = await run(await mintPreviewCookie('test-secret'));
        expect(locals.preview).toBe(true);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
    test('an expired cookie fails silently -- the "stopped working" symptom', async () => {
        const { locals } = await run(await mintPreviewCookie('test-secret', Math.floor(Date.now() / 1000) - 31 * 24 * 3600));
        expect(locals.preview).toBe(false);
    });
    test('a cookie minted under a different secret fails', async () => {
        const { locals } = await run(await mintPreviewCookie('other'));
        expect(locals.preview).toBe(false);
    });
    test('no cookie leaves preview unset', async () => {
        const { locals } = await run(null);
        expect(locals.preview).toBeUndefined();
    });
});

describe('the preview magic link', () => {
    async function redeem(token: string) {
        const ctx: any = {
            request: new Request(`https://gameonpaper.com/game/401752746?span=q3&${PREVIEW_LINK_PARAM}=${token}`),
            locals: {},
            cache: { set: () => {} },
            redirect: (l: string) => new Response(null, { status: 302, headers: { Location: l } }),
        };
        return (await (onRequest as any)(ctx, async () => new Response('ok'))) as Response;
    }

    test('a valid link 302s onto the /preview surface with a working cookie, uncacheable', async () => {
        // NOT the clean URL: that one is publicly cached, and a Workers
        // Caching HIT never runs the middleware -- the cookie would be
        // invisible and the viewer would see the public copy
        const res = await redeem(await mintPreviewLink('test-secret'));
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/preview/game/401752746?span=q3');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const setCookie = res.headers.get('Set-Cookie') ?? '';
        expect(setCookie).toContain(`${PREVIEW_COOKIE}=`);
        expect(setCookie).toContain('HttpOnly');
        const value = setCookie.split(';')[0].split('=').slice(1).join('=');
        expect(await verifyPreviewCookie(value, 'test-secret')).toBe(true);
    });
    test('an expired link still strips the param but sets no cookie', async () => {
        const res = await redeem(await mintPreviewLink('test-secret', Math.floor(Date.now() / 1000) - 15 * 24 * 3600));
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/game/401752746?span=q3');
        expect(res.headers.get('Set-Cookie')).toBeNull();
    });
    test('tokens are purpose-separated: a link token is not a cookie and vice versa', async () => {
        expect(await verifyPreviewCookie(await mintPreviewLink('test-secret'), 'test-secret')).toBe(false);
        expect(await verifyPreviewLink(await mintPreviewCookie('test-secret'), 'test-secret')).toBe(false);
    });

    test('a keyed LEGACY URL is redeemed first, resolved onto the preview surface', async () => {
        // the legacy /cfb 301s forward the query string with no cache headers;
        // if they ran before the redeem, a heuristically-cacheable redirect
        // would carry the key (review on #213). Redeem must win, and the
        // legacy path resolves BEFORE prefixing: /preview/* rewrites straight
        // to routes, so an unresolved legacy path would 404 there.
        const token = await mintPreviewLink('test-secret');
        const ctx: any = {
            request: new Request(`https://gameonpaper.com/cfb/game/401752746?span=q3&${PREVIEW_LINK_PARAM}=${token}`),
            locals: {},
            cache: { set: () => {} },
            redirect: (l: string, code = 302) => new Response(null, { status: code, headers: { Location: l } }),
        };
        const res = await (onRequest as any)(ctx, async () => new Response('ok'));
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/preview/game/401752746?span=q3');
        expect(res.headers.get('Location')).not.toContain(PREVIEW_LINK_PARAM);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(res.headers.get('Set-Cookie')).toContain(PREVIEW_COOKIE);
    });

    test('the /preview surface rewrites to the real route with preview on, never cached', async () => {
        let rewrittenTo: unknown = 'not called';
        const ctx: any = {
            request: new Request('https://gameonpaper.com/preview/game/401752746?span=q3', {
                headers: { cookie: `${PREVIEW_COOKIE}=${await mintPreviewCookie('test-secret')}` },
            }),
            locals: {},
            cache: { set: () => {} },
            redirect: (l: string) => new Response(null, { status: 302, headers: { Location: l } }),
        };
        const res = await (onRequest as any)(ctx, async (rw: unknown) => { rewrittenTo = rw; return new Response('page'); });
        expect(res.status).toBe(200);
        expect(rewrittenTo).toBe('/game/401752746?span=q3');
        expect(ctx.locals.preview).toBe(true);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    });

    test('the /preview surface never rewrites into /admin, even with a valid cookie', async () => {
        // the admin auth gate checks the ORIGINAL pathname; a rewrite would
        // carry a view-only preview cookie past it (Sourcery on #217)
        const ctx: any = {
            request: new Request('https://gameonpaper.com/preview/admin/api/purge-game', {
                headers: { cookie: `${PREVIEW_COOKIE}=${await mintPreviewCookie('test-secret')}` },
            }),
            locals: {},
            cache: { set: () => {} },
            redirect: (l: string) => new Response(null, { status: 302, headers: { Location: l } }),
        };
        const res = await (onRequest as any)(ctx, async () => new Response('SECRET'));
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/admin/api/purge-game');
        expect(ctx.locals.preview).toBeUndefined();
    });

    test('the /preview surface without a valid cookie bounces to the public path', async () => {
        const ctx: any = {
            request: new Request('https://gameonpaper.com/preview/game/401752746?span=q3'),
            locals: {},
            cache: { set: () => {} },
            redirect: (l: string) => new Response(null, { status: 302, headers: { Location: l } }),
        };
        const res = await (onRequest as any)(ctx, async () => new Response('page'));
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/game/401752746?span=q3');
    });

    test('the cache guard forces no-store on any response for a keyed URL', async () => {
        // belt and braces: even if the redeem ever regressed and a keyed URL
        // rendered, the response must not be cacheable under that URL
        const { withPreviewCacheGuard } = await import('../src/middleware');
        const ctx: any = {
            request: new Request(`https://gameonpaper.com/game/1?${PREVIEW_LINK_PARAM}=v1.1.abc`),
            locals: {},
            cache: { set: () => {} },
        };
        const res = withPreviewCacheGuard(ctx, new Response('page'));
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
});
