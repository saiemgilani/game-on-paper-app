import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { PREVIEW_LINK_PARAM, PREVIEW_LINK_TTL_S, mintPreviewLink } from '../../../utils/preview';

export const prerender = false;

// Mint a shareable preview magic link (see utils/preview.ts). Behind /admin
// auth via the middleware. POST {"path": "/game/401..."} (default "/") returns
// a URL that, opened in any browser, sets the preview cookie via the
// middleware redeem and redirects to the clean path.
export const POST: APIRoute = async ({ request }) => {
    const secret = getSecret('ADMIN_PASS');
    if (!secret) return Response.json({ ok: false, error: 'ADMIN_PASS not set' }, { status: 500 });
    let path = '/';
    try {
        const body = (await request.json()) as { path?: unknown };
        if (typeof body?.path === 'string' && body.path.length > 0) path = body.path;
    } catch { /* empty body -> site root */ }
    // Same-site paths only: no scheme/host smuggling into the copied link.
    // Backslashes are rejected because the URL parser treats "/\evil.example"
    // as "//evil.example" and would resolve it to another host.
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
        return Response.json({ ok: false, error: 'path must be a same-site path starting with a single "/"' }, { status: 400 });
    }
    const origin = new URL(request.url).origin;
    const token = await mintPreviewLink(secret);
    const target = new URL(path, origin);
    if (target.origin !== origin) {
        return Response.json({ ok: false, error: 'path resolved off-site' }, { status: 400 });
    }
    target.searchParams.set(PREVIEW_LINK_PARAM, token);
    return Response.json({
        ok: true,
        url: target.toString(),
        expires_in_days: PREVIEW_LINK_TTL_S / 86400,
    }, { headers: { 'Cache-Control': 'no-store' } });
};
