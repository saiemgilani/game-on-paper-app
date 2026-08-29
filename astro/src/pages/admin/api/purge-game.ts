import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Purge cached game pages from inside the Worker. Workers Caching is scoped to
// the Worker: no zone-level purge (dashboard, API, Terraform) reaches it, only
// ctx.cache.purge -- which Astro exposes as cache.invalidate. Behind /admin
// basic auth. `?ids=401856766,401864570` (also accepts a JSON body {ids: []}).
export const GET: APIRoute = async (context) => purge(context);
export const POST: APIRoute = async (context) => purge(context);

async function purge(context: Parameters<APIRoute>[0]): Promise<Response> {
    let ids: string[] = (context.url.searchParams.get('ids') ?? '').split(',');
    if (context.request.method === 'POST') {
        try { ids = ids.concat(((await context.request.json()) as { ids?: unknown[] })?.ids?.map(String) ?? []); } catch { /* no body */ }
    }
    ids = [...new Set(ids.map((s) => s.trim()).filter((s) => /^\d{6,12}$/.test(s)))];
    if (ids.length === 0) return Response.json({ ok: false, error: 'no valid game ids' }, { status: 400 });
    const results: Record<string, string> = {};
    for (const id of ids) {
        try {
            await context.cache.invalidate({ path: `/game/${id}` });
            // A forced refresh also resets the regression guard's high-water mark:
            // a stale or inflated mark makes every honest payload "regress", which
            // renders the page uncached on every request.
            await env.ESPN_API_CACHE.delete(`gamestate:${id}`);
            results[id] = 'purged';
        } catch (e: any) {
            results[id] = `error: ${e?.message ?? e}`;
        }
    }
    context.cache.set(false);
    return Response.json({ ok: Object.values(results).every((v) => v === 'purged'), results },
        { headers: { 'Cache-Control': 'no-store' } });
}
