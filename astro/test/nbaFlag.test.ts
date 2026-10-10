import { describe, expect, test, vi } from 'vitest';

// The NBA surface sits behind the 'nba' feature flag (utils/features.ts), gated once in
// middleware exactly like 'nfl': every /nba path is the site's 404 unless the viewer
// holds the preview cookie. Promotion flips 'preview' -> 'on' once the routes the nav already
// links to (PR 2 and PR 3) and a football-Header NBA entry exist; see the flag's comment.
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';

async function run(path: string, cookie: string | null) {
    const locals: Record<string, unknown> = {};
    let rewrittenTo: string | undefined = 'never-called';
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`, { headers: cookie ? { cookie: `${PREVIEW_COOKIE}=${cookie}` } : {} }),
        locals,
        cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    const res = await (onRequest as any)(ctx, async (to?: string) => { rewrittenTo = to; return new Response('ok'); });
    return { locals, res, rewrittenTo };
}

const NBA_PATHS = ['/nba', '/nba/', '/nba/players/1629008', '/nba/players/1629008?season=2024', '/nba/team/1610612751'];

describe('the nba flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['nba']).toBe('preview');
        expect(isFeatureEnabled('nba', {})).toBe(false);
        expect(isFeatureEnabled('nba', { preview: true })).toBe(true);
    });
    test('a public viewer gets the 404 for every /nba route, and only those', async () => {
        for (const p of NBA_PATHS) expect((await run(p, null)).rewrittenTo, p).toBe('/404');
        for (const p of ['/', '/teams', '/nbax', '/game/401752746']) expect((await run(p, null)).rewrittenTo, p).not.toBe('/404');
    });
    test('a preview viewer reaches the routes', async () => {
        const cookie = await mintPreviewCookie('test-secret');
        for (const p of NBA_PATHS) expect((await run(p, cookie)).rewrittenTo, p).not.toBe('/404');
    });
});
