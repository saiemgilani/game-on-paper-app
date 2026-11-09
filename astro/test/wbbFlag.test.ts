import { describe, expect, test, vi } from 'vitest';

// The WBB surface sits behind the 'wbb' flag, gated in middleware by plan #4's PREFIXED_LEAGUES loop (as mbbFlag).
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

const WBB_PATHS = ['/wbb', '/wbb/', '/wbb/scoreboard', '/wbb/scoreboard?date=2026-02-07&group=all', '/wbb/game/401805076'];

describe('the wbb flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['wbb']).toBe('preview');
        expect(isFeatureEnabled('wbb', {})).toBe(false);
        expect(isFeatureEnabled('wbb', { preview: true })).toBe(true);
    });
    test('a public viewer gets the 404 for every /wbb route, and only those', async () => {
        for (const p of WBB_PATHS) expect(await run(p, null), p).toBe('/404');
        for (const p of ['/', '/teams', '/wbbx', '/game/401752746']) expect(await run(p, null), p).not.toBe('/404');
    });
    test('a preview viewer reaches the routes', async () => {
        const cookie = await mintPreviewCookie('test-secret');
        for (const p of WBB_PATHS) expect(await run(p, cookie), p).not.toBe('/404');
    });
});
