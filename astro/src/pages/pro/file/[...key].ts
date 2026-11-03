import type { APIRoute } from 'astro';
import { isProKey, proFile } from '../../../resources/pro';

export const prerender = false;

// /pro/file/<R2 key>: streams a Pro PDF or CSV from the private bucket to an
// entitled viewer. The middleware already answered 403 to anyone else; the check
// is repeated here so the route is safe on its own. Never a redirect to the raw
// object -- the bucket has no public URL, and the Worker is the only reader.
export const GET: APIRoute = async ({ params, locals }) => {
    const headers = { 'Cache-Control': 'no-store' };
    if (!locals.pro) return new Response('Forbidden', { status: 403, headers });
    const key = params.key ?? '';
    const file = isProKey(key) ? await proFile(key) : null;
    if (!file) return new Response('Not found', { status: 404, headers });
    return new Response(file.body, {
        headers: {
            ...headers,
            'Content-Type': file.contentType,
            'Content-Disposition': `attachment; filename="${key.split('/').slice(-3).join('-')}"`,
        },
    });
};
