import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { PREVIEW_COOKIE, PREVIEW_TTL_S, mintPreviewCookie, readCookie, verifyPreviewCookie } from '../../../utils/preview';

export const prerender = false;

// Toggle admin preview mode (see utils/features.ts). Behind /admin basic auth
// via the middleware. GET reports state; POST {"on": true|false} sets or
// clears the signed cookie for the whole site (Path=/).
export const GET: APIRoute = async ({ request }) => {
    const enabled = await verifyPreviewCookie(
        readCookie(request.headers.get('cookie'), PREVIEW_COOKIE), getSecret('ADMIN_PASS'));
    return Response.json({ enabled }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: APIRoute = async ({ request }) => {
    const secret = getSecret('ADMIN_PASS');
    if (!secret) return Response.json({ ok: false, error: 'ADMIN_PASS not set' }, { status: 500 });
    let on: unknown;
    try { on = ((await request.json()) as { on?: unknown })?.on; } catch { on = undefined; }
    if (typeof on !== 'boolean') {
        return Response.json({ ok: false, error: 'body must be {"on": true|false}' }, { status: 400 });
    }
    const cookie = on
        ? `${PREVIEW_COOKIE}=${await mintPreviewCookie(secret)}; Path=/; Max-Age=${PREVIEW_TTL_S}; HttpOnly; Secure; SameSite=Lax`
        : `${PREVIEW_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
    return Response.json({ ok: true, enabled: on }, {
        headers: { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
    });
};
