import type { APIRoute } from 'astro';
import { sessionCookie } from '../../utils/preview';
import { PRO_COOKIE } from '../../utils/pro';

export const prerender = false;

// Sign out: clear the gop_pro cookie and go home. POST, like /admin/api/logout.
export const POST: APIRoute = async ({ request }) => new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': sessionCookie(PRO_COOKIE, '', 0, request.url), 'Cache-Control': 'no-store' },
});
