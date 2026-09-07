import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

// Regression-guard inspector: the per-game high-water marks the game-state
// guard keeps in Workers KV (resources/espn.ts, gamestate:<id>). A stale or
// inflated mark makes every honest ESPN payload look like a regression, which
// renders that page uncached on every request -- this makes those marks
// visible, next to what they recorded. Reset = the existing purge-game?ids=
// (which deletes the mark alongside the page). Behind /admin via middleware.
export const GET: APIRoute = async () => {
    const marks: Record<string, unknown>[] = [];
    try {
        // follow the cursor: KV pages at 1000 keys, and past-game marks live a
        // full day, so a Saturday can exceed one page. Hard cap keeps the
        // endpoint bounded either way.
        const keys: { name: string }[] = [];
        let cursor: string | undefined;
        do {
            const page: any = await env.ESPN_API_CACHE.list({ prefix: 'gamestate:', cursor });
            keys.push(...page.keys);
            cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor && keys.length < 2000);
        for (const k of keys) {
            const gameId = k.name.slice('gamestate:'.length);
            try {
                const state = await env.ESPN_API_CACHE.get(k.name, 'json') as Record<string, unknown> | null;
                marks.push({ game_id: gameId, ...(state ?? {}) });
            } catch {
                marks.push({ game_id: gameId, error: 'unreadable' });
            }
        }
    } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e) },
            { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
    return Response.json({ ok: true, marks }, { headers: { 'Cache-Control': 'no-store' } });
};
