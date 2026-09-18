import { describe, expect, test, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

// The head-coach boards sit behind the 'coaches' feature flag
// (utils/features.ts): middleware turns every board route -- both leagues --
// into the site's 404 unless the viewer holds the preview cookie, and the
// header's Head Coaches section renders only for such a viewer. Promotion is
// 'preview' -> 'on' and nothing else.
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : undefined) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { mintPreviewCookie, PREVIEW_COOKIE } from '../src/utils/preview';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';
import { isCoachBoardPath } from '../src/utils/coaches';

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

const BOARD_PATHS = [
    '/coaches', '/coaches/', '/coaches/pace', '/coaches/fourth-downs?sort=go_rate',
    '/year/2025/coaches', '/year/2025/coaches/pace', '/year/2004/coaches/defense',
    '/nfl/coaches/pace', '/nfl/year/2024/coaches/fourth-downs',
];

describe('the coaches flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['coaches']).toBe('preview');
        expect(isFeatureEnabled('coaches', {})).toBe(false);
        expect(isFeatureEnabled('coaches', { preview: true })).toBe(true);
    });

    test('isCoachBoardPath matches the board routes in both leagues, segment-exact', () => {
        for (const p of BOARD_PATHS) expect(isCoachBoardPath(p.split('?')[0]), p).toBe(true);
        for (const p of [
            '/', '/nfl', '/coachesx', '/year/2025/coachesx/pace', '/year/2025/teams/differential',
            '/year/2025/team/194', '/team/194', '/nfl/year/2024/teams/tendencies', '/game/401752746',
            '/rankings', '/year/2025/coaches-poll',
        ]) {
            expect(isCoachBoardPath(p), p).toBe(false);
        }
    });

    test('a public viewer gets the 404 for every board route, and only those', async () => {
        for (const p of BOARD_PATHS) {
            expect((await run(p, null)).rewrittenTo, p).toBe('/404');
        }
        // the rest of the cfb site -- including the team leaderboards the boards sit beside -- is untouched
        for (const p of ['/', '/year/2025/teams/differential', '/year/2025/players/passing', '/game/401752746', '/coachesx']) {
            expect((await run(p, null)).rewrittenTo, p).toBeUndefined();
        }
    });

    test('the preview cookie on the public URL renders the boards, uncacheable', async () => {
        for (const p of ['/year/2025/coaches/pace', '/coaches/pace', '/nfl/coaches/pace']) {
            const { locals, res, rewrittenTo } = await run(p, await mintPreviewCookie('test-secret'));
            expect(locals.preview, p).toBe(true);
            expect(rewrittenTo, p).toBeUndefined();
            expect(res.headers.get('Cache-Control'), p).toBe('no-store');
        }
    });

    test('/preview/year/N/coaches/... composes: the strip happens first, then the gate admits the cookie holder', async () => {
        const { rewrittenTo } = await run('/preview/year/2025/coaches/pace?sort=plays', await mintPreviewCookie('test-secret'));
        expect(rewrittenTo).toBe('/year/2025/coaches/pace?sort=plays');
        const bounced = await run('/preview/coaches/pace', null);
        expect(bounced.res.status).toBe(302);
        expect(bounced.res.headers.get('Location')).toBe('/coaches/pace');
    });

    test('the header lists the Head Coaches section only to a viewer the flag admits', async () => {
        const container = await AstroContainer.create();
        const { default: Header } = await import('../src/components/Header.astro');
        const req = new Request('https://gameonpaper.com/');
        const pub = await container.renderToString(Header, { request: req, locals: {} });
        expect(pub).not.toContain('Head Coaches');
        expect(pub).not.toContain('/coaches/');
        // the neighbouring leaderboard links are still there for everyone
        expect(pub).toContain('/teams/differential');
        const prev = await container.renderToString(Header, { request: req, locals: { preview: true } });
        expect(prev).toContain('Head Coaches');
        expect(prev).toContain('/coaches/pace');
    }, 30_000);
});
