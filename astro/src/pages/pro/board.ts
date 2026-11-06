import type { APIRoute } from 'astro';
import { parseBoardFilters } from '../../utils/pro';
import { readBoard, writeBoard, writeFilters } from '../../resources/pro';

export const prerender = false;

// The Portal Board's form target (pages/pro/portal.astro). action=add|remove keeps
// a row on the viewer's own board; action=filters|clear-filters saves or clears the
// filters the morning digest matches. Back to the board view the form came from.
// Entitled viewers only: the middleware has already turned everyone else away.
export const POST: APIRoute = async ({ request, locals }) => {
    const email = locals.pro?.email;
    if (!email) return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    let form: FormData;
    try { form = await request.formData(); } catch { return new Response('Bad request', { status: 400 }); }
    const action = String(form.get('action') ?? '');
    const key = String(form.get('key') ?? '').slice(0, 200);
    if ((action === 'add' || action === 'remove') && key) {
        const keys = await readBoard(email);
        await writeBoard(email, action === 'add' ? [...keys, key] : keys.filter((k) => k !== key));
    } else if (action === 'filters') {
        await writeFilters(email, parseBoardFilters(Object.fromEntries(form)));
    } else if (action === 'clear-filters') {
        await writeFilters(email, null);
    } else {
        return new Response('Bad request', { status: 400 });
    }
    // same-site board views only, so the form cannot be turned into an open redirect
    const back = String(form.get('back') ?? '');
    const location = /^\/pro\/portal(\?[^\\]*)?$/.test(back) ? back : '/pro/portal';
    return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
};
