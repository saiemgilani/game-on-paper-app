import type { APIRoute } from 'astro';
import { ADMIN_COOKIE } from '../../../utils/adminSession';
import { sessionCookie } from '../../../utils/preview';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => new Response(null, {
    status: 303,
    headers: {
        Location: '/admin/login',
        'Set-Cookie': sessionCookie(ADMIN_COOKIE, '', 0, request.url),
        'Cache-Control': 'no-store',
    },
});
