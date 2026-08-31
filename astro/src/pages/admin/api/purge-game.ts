import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Purge cached pages from inside the Worker. Workers Caching is scoped to the
// Worker: no zone-level purge (dashboard, API, Terraform) reaches it, only
// ctx.cache.purge -- which Astro exposes as cache.invalidate. Behind /admin
// basic auth.
//   ?tags=game-completed          every final game page (after a parser fix)
//   ?ids=401856766,401864570      specific games (also resets their regression mark)
// Both may be combined. The API-layer response cache is keyed on APP_VERSION,
// so a deploy already invalidates it; this only has to clear the rendered pages.
const KNOWN_TAGS = new Set(['game-completed', 'game-in-progress', 'game-scheduled-today',
    'game-scheduled-future', 'scoreboard', 'matchup', 'favorites-enabled',
    // week/schedule + chart pages (see the tags: lists in utils/config.ts and pages/)
    'week-complete', 'week-in-progress', 'week-scheduled-current-week',
    'week-scheduled-current-season', 'chart']);

export const GET: APIRoute = async (context) => purge(context);
export const POST: APIRoute = async (context) => purge(context);

async function purge(context: Parameters<APIRoute>[0]): Promise<Response> {
    const q = context.url.searchParams;
    let ids = (q.get('ids') ?? '').split(',');
    let tags = (q.get('tags') ?? '').split(',');
    if (context.request.method === 'POST') {
        try {
            const body = (await context.request.json()) as { ids?: unknown[]; tags?: unknown[] };
            ids = ids.concat(body?.ids?.map(String) ?? []);
            tags = tags.concat(body?.tags?.map(String) ?? []);
        } catch { /* no body */ }
    }
    ids = [...new Set(ids.map((s) => s.trim()).filter((s) => /^\d{6,12}$/.test(s)))];
    const badTags = tags.map((s) => s.trim()).filter((s) => s && !KNOWN_TAGS.has(s));
    tags = [...new Set(tags.map((s) => s.trim()).filter((s) => KNOWN_TAGS.has(s)))];
    if (badTags.length) return Response.json({ ok: false, error: `unknown tags: ${badTags.join(',')}`, known: [...KNOWN_TAGS] }, { status: 400 });
    if (ids.length === 0 && tags.length === 0) return Response.json({ ok: false, error: 'give ?ids= and/or ?tags=' }, { status: 400 });

    const results: Record<string, string> = {};
    if (tags.length) {
        try {
            await context.cache.invalidate({ tags });
            for (const t of tags) results[`tag:${t}`] = 'purged';
        } catch (e: any) {
            for (const t of tags) results[`tag:${t}`] = `error: ${e?.message ?? e}`;
        }
    }
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
