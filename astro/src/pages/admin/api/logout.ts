import type { APIRoute } from 'astro';
import { ADMIN_COOKIE } from '../../../utils/adminSession';

export const prerender = false;

export const POST: APIRoute = async () => new Response(null, {
    status: 303,
    headers: {
        Location: '/admin/login',
        'Set-Cookie': `${ADMIN_COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
    },
});
