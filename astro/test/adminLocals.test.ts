import { describe, expect, test, vi } from 'vitest';

// The admin SESSION is verified on every route, not just /admin, so a public
// page can show admin-only detail (the player game log's QA badge) without
// inventing its own check. Three things have to hold for that to be safe:
// only a valid admin cookie sets it, a preview cookie never does, and basic
// auth -- which exists for scripted callers of /admin/api/* -- does not turn a
// curl of a public page into an admin render.
vi.mock('astro:env/server', () => ({ getSecret: (k: string) => (k === 'ADMIN_PASS' ? 'test-secret' : (k === 'ADMIN_USER' ? 'gop' : undefined)) }));
vi.mock('astro:middleware', () => ({ defineMiddleware: (fn: unknown) => fn }));

import { onRequest } from '../src/middleware';
import { ADMIN_COOKIE, mintAdminCookie } from '../src/utils/adminSession';
import { PREVIEW_COOKIE, mintPreviewCookie } from '../src/utils/preview';

async function run(path: string, headers: Record<string, string> = {}) {
    const locals: Record<string, unknown> = {};
    const ctx: any = {
        request: new Request(`https://gameonpaper.com${path}`, { headers }),
        locals,
        cache: { set: () => {} },
        redirect: (l: string, status = 302) => new Response(null, { status, headers: { Location: l } }),
    };
    const res = await (onRequest as any)(ctx, async () => new Response('ok'));
    return { locals, res };
}

describe('adminAuthed on a public route', () => {
    test('a valid admin cookie authenticates anywhere, not only under /admin', async () => {
        const cookie = await mintAdminCookie('test-secret');
        const { locals } = await run('/players/4433971', { cookie: `${ADMIN_COOKIE}=${cookie}` });
        expect(locals.adminAuthed).toBe(true);
    });

    test('no cookie, a junk cookie and an expired one all leave it unset', async () => {
        const expired = await mintAdminCookie('test-secret', Math.floor(Date.now() / 1000) - 60 * 60 * 24);
        for (const headers of [{}, { cookie: `${ADMIN_COOKIE}=v1.9999999999.deadbeef` }, { cookie: `${ADMIN_COOKIE}=${expired}` }]) {
            const { locals } = await run('/players/4433971', headers);
            expect(locals.adminAuthed, JSON.stringify(headers)).toBeUndefined();
        }
    });

    test('a preview cookie is a view-only pass, never an admin session', async () => {
        const preview = await mintPreviewCookie('test-secret');
        const { locals } = await run('/players/4433971', { cookie: `${PREVIEW_COOKIE}=${preview}` });
        expect(locals.preview).toBe(true);
        expect(locals.adminAuthed).toBeUndefined();
    });

    test('basic auth stays scoped to /admin, so a curl of a public page is not an admin render', async () => {
        const auth = { authorization: 'Basic ' + btoa('gop:test-secret') };
        expect((await run('/players/4433971', auth)).locals.adminAuthed).toBeUndefined();
        expect((await run('/admin', auth)).locals.adminAuthed).toBe(true);
    });

    test('an admin render is forced out of Workers Caching', async () => {
        const cookie = await mintAdminCookie('test-secret');
        const { res } = await run('/players/4433971', { cookie: `${ADMIN_COOKIE}=${cookie}` });
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
});
