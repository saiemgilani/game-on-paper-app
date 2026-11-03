import { describe, expect, test, vi } from 'vitest';

// Middleware gates compare url.pathname; Astro routes on the fully decoded path. The
// middleware therefore canonicalizes any percent-encoded spelling first, so a gate always
// sees the path the router will match.
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => ({ ADMIN_PASS: 'test-secret' } as Record<string, string>)[k] }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));
vi.mock('cloudflare:workers', () => ({ env: {} }));

import { canonicalPath, onRequest } from '../src/middleware';

async function run(path: string) {
    let nextCalled = false;
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`),
        locals: {},
        cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    const res: Response = await (onRequest as any)(ctx, async () => { nextCalled = true; return new Response('ok'); });
    return { res, nextCalled };
}

describe('percent-encoded paths are canonicalized before any gate', () => {
    test.each([
        ['/%61dmin', '/admin'],
        ['/a%64min/api/purge', '/admin/api/purge'],
        ['/%6Efl', '/nfl'],
        ['/pr%6F/players/1', '/pro/players/1'],
        ['/%2561dmin', '/admin'], // double-encoded
        ['/%61dmin?x=1', '/admin?x=1'],
    ])('%s redirects to %s without rendering', async (raw, canon) => {
        const { res, nextCalled } = await run(raw);
        expect(nextCalled).toBe(false);
        expect(res.status).toBe(308);
        expect(res.headers.get('Location')).toBe(canon);
    });

    test('the canonical /admin is then gated as usual', async () => {
        const { res, nextCalled } = await run('/admin');
        expect(nextCalled).toBe(false);
        expect([302, 401]).toContain(res.status);
    });

    test('already-canonical encodings pass through untouched (no redirect loop)', async () => {
        for (const p of ['/team/a%20b', '/players/caf%C3%A9']) {
            expect(canonicalPath(p), p).toBe(p);
            expect((await run(p)).res.headers.get('Location'), p).toBeNull();
        }
    });

    test('malformed encoding is a 400, never routed', async () => {
        const { res, nextCalled } = await run('/%E0%A4%A');
        expect(nextCalled).toBe(false);
        expect(res.status).toBe(400);
    });

    test('a decoded ? or # stays in the path instead of becoming a query', () => {
        expect(canonicalPath('/a%3Fb')).toBe('/a%3Fb');
        expect(canonicalPath('/a%23b')).toBe('/a%23b');
    });
});
