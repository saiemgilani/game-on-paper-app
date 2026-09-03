import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { ADMIN_COOKIE, ADMIN_SESSION_TTL_S, mintAdminCookie, timingSafeEqual } from '../../../utils/adminSession';

export const prerender = false;

// Form target for /admin/login. On success: signed session cookie + 303 to
// /admin. On failure: back to the form with ?err=1 (no oracle about which
// field was wrong). SameSite=Lax keeps the cookie off cross-site POSTs.
export const POST: APIRoute = async ({ request }) => {
    const user = getSecret('ADMIN_USER');
    const pass = getSecret('ADMIN_PASS');
    let u = '', p = '';
    try {
        const form = await request.formData();
        u = String(form.get('username') ?? '');
        p = String(form.get('password') ?? '');
    } catch { /* fall through to failure */ }
    const ok = Boolean(user && pass) && timingSafeEqual(u, user!) && timingSafeEqual(p, pass!);
    if (!ok) {
        return new Response(null, { status: 303, headers: { Location: '/admin/login?err=1' } });
    }
    return new Response(null, {
        status: 303,
        headers: {
            Location: '/admin',
            'Set-Cookie': `${ADMIN_COOKIE}=${await mintAdminCookie(pass!)}; Path=/admin; Max-Age=${ADMIN_SESSION_TTL_S}; HttpOnly; Secure; SameSite=Lax`,
            'Cache-Control': 'no-store',
        },
    });
};
