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

    test('a valid link 302s to the clean URL with a working preview cookie, uncacheable', async () => {
        const res = await redeem(await mintPreviewLink('test-secret'));
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/game/401752746?span=q3');
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
});
