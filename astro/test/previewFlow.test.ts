import { describe, expect, test, vi } from 'vitest';

// End-to-end preview chain: a minted cookie through the REAL middleware must
// set locals.preview, and an expired one must not -- silently, which is the
// on-page symptom "preview features stopped working".
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';

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
        const { locals } = await run(await mintPreviewCookie('test-secret', Math.floor(Date.now() / 1000) - 8 * 24 * 3600));
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
