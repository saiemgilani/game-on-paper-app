import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { sessionCookie } from '../../utils/preview';
import { mintProCookie, PRO_COOKIE, PRO_COOKIE_TTL_S } from '../../utils/pro';
import { redeemLoginToken } from '../../resources/pro';

export const prerender = false;

// The magic link's landing: /pro/auth?t=<token>. A live token is consumed (one
// use), the signed gop_pro cookie is set, and the viewer lands on /pro. Anything
// else goes back to the sign-in form. The middleware keeps this path no-store.
export const GET: APIRoute = async ({ url, request }) => {
    const secret = getSecret('PRO_COOKIE_SECRET');
    const email = secret ? await redeemLoginToken(url.searchParams.get('t')) : null;    if (!email || !secret) {
        return new Response(null, { status: 302, headers: { Location: '/pro/login?err=1', 'Cache-Control': 'no-store' } });
    }
    return new Response(null, {
        status: 302,
        headers: {
            Location: '/pro',
            'Set-Cookie': sessionCookie(PRO_COOKIE, await mintProCookie(email, secret), PRO_COOKIE_TTL_S, request.url),
            'Cache-Control': 'no-store',
        },
    });
};
