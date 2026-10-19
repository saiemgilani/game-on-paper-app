import { describe, expect, test, vi } from 'vitest';

// The WNBA surface sits behind the 'wnba' flag, gated once in middleware by plan #4's PREFIXED_LEAGUES loop, exactly like
// 'nba' (nbaFlag.test.ts): every /wnba path is the site's 404 unless the viewer holds the preview cookie.
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

const WNBA_PATHS = ['/wnba', '/wnba/', '/wnba/scoreboard', '/wnba/scoreboard?date=2025-08-01', '/wnba/game/401736287', '/wnba/game/250603003'];

describe('the wnba flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['wnba']).toBe('preview');
        expect(isFeatureEnabled('wnba', {})).toBe(false);
        expect(isFeatureEnabled('wnba', { preview: true })).toBe(true);
    });
    test('a public viewer gets the 404 for every /wnba route, and only those', async () => {
        for (const p of WNBA_PATHS) expect(await run(p, null), p).toBe('/404');
        for (const p of ['/', '/teams', '/wnbax', '/game/401752746']) expect(await run(p, null), p).not.toBe('/404');
    });
    test('a preview viewer reaches the routes', async () => {
        const cookie = await mintPreviewCookie('test-secret');
        for (const p of WNBA_PATHS) expect(await run(p, cookie), p).not.toBe('/404');
    });
});
