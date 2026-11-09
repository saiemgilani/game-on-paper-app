import { describe, expect, test, vi } from 'vitest';

// The MBB surface sits behind the 'mbb' flag, gated in middleware by plan #4's PREFIXED_LEAGUES loop (as nbaFlag/wnbaFlag).
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';

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

const MBB_PATHS = ['/mbb', '/mbb/', '/mbb/scoreboard', '/mbb/scoreboard?date=2025-02-22&group=all', '/mbb/game/401820775'];

describe('the mbb flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['mbb']).toBe('preview');
        expect(isFeatureEnabled('mbb', {})).toBe(false);
        expect(isFeatureEnabled('mbb', { preview: true })).toBe(true);
    });
    test('a public viewer gets the 404 for every /mbb route, and only those', async () => {
        for (const p of MBB_PATHS) expect(await run(p, null), p).toBe('/404');
        for (const p of ['/', '/teams', '/mbbx', '/game/401752746']) expect(await run(p, null), p).not.toBe('/404');
    });
    test('a preview viewer reaches the routes', async () => {
        const cookie = await mintPreviewCookie('test-secret');
        for (const p of MBB_PATHS) expect(await run(p, cookie), p).not.toBe('/404');
    });
});
