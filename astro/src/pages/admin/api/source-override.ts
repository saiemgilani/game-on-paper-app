import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { retrieveGameSources } from '../../../resources/python';
import { leaguePath, type League } from '../../../utils/league';
import { OVERRIDE_LEAGUES, OVERRIDE_PREFIX, overrideKey, type SourceOverride } from '../../../utils/sourceOverride';
import { auditAdmin } from '../../../utils/telemetry';

export const prerender = false;

// Per-game source overrides (utils/sourceOverride.ts). Behind /admin via the
// middleware, like every /admin/api route.
//   GET                                       every pin
//   POST {league, id, source: "shield"}       pin a game to a source
//   POST {league, id, source: null}           remove the pin
// A pin is validated against the processor's registry for that game
// (GET /{league}/{id}/sources), and setting or removing one purges the game's
// rendered page and share card so the next render follows it. Kept cards in KV
// need no purge: their key carries the source (routes/shareCard.ts cardKey).
//
// CSRF: the admin cookie is SameSite=Lax, so a sibling subdomain is same-site.
// Astro's checkOrigin (on by default) rejects a cross-origin form-type POST, and
// this handler takes application/json only, which no cross-origin page can send
// without a CORS preflight this route never answers.
const LIST_CAP = 2000;
const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET: APIRoute = async () => {
    try {
        const keys: { name: string; metadata?: unknown }[] = [];
        let cursor: string | undefined;
        do {
            const page: any = await env.ESPN_API_CACHE.list({ prefix: OVERRIDE_PREFIX, cursor });
            keys.push(...page.keys);
            cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor && keys.length < LIST_CAP);
        const overrides = keys.map((k) => {
            const [league, game_id] = k.name.slice(OVERRIDE_PREFIX.length).split(':');
            return { league, game_id, ...((k.metadata ?? {}) as Partial<SourceOverride>) };
        });
        // `truncated`: the cap was hit (KV pages at 1000 keys); /admin says so rather than pass a partial list as whole
        return Response.json({ ok: true, overrides, truncated: !!cursor }, { headers: NO_STORE });
    } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500, headers: NO_STORE });
    }
};

export const POST: APIRoute = async (context) => {
    // every rejection is audited too: a refused attempt is still an admin action
    const bad = (error: string, detail: string, status = 400) => {
        auditAdmin(context.locals, 'source-override', `${detail} (rejected: ${error})`, false);
        return Response.json({ ok: false, error }, { status, headers: NO_STORE });
    };
    if (!/^application\/json\b/i.test(context.request.headers.get('content-type') ?? '')) {
        return bad('content-type must be application/json', 'non-json body', 415);
    }
    let body: { league?: unknown; id?: unknown; source?: unknown } = {};
    try { body = (await context.request.json()) ?? {}; } catch { /* no body */ }
    const league = body.league as League;
    const id = String(body.id ?? '');
    const source = body.source;
    const detail = `${String(league).slice(0, 12)}:${id.slice(0, 16)} ${typeof source === 'string' ? source.slice(0, 32) : source === null ? 'removed' : typeof source}`;
    if (!OVERRIDE_LEAGUES.includes(league)) return bad(`league must be one of ${OVERRIDE_LEAGUES.join(', ')}`, detail);
    if (!/^\d{6,12}$/.test(id)) return bad('id must be an ESPN game id', detail);
    if (source !== null && typeof source !== 'string') return bad('source must be a source name, or null to remove the pin', detail);
    if (source === 'espn') return bad('espn is the default: remove the pin instead', detail);

    if (source !== null) {
        // retrieveGameSources is timeboxed (SOURCES_TIMEOUT_MS): a stalled processor lands here as "unreachable"
        const known = (await retrieveGameSources(id, league))?.sources ?? [];
        if (!known.includes(source)) {
            return bad(`unknown source ${source} for ${league}; known: ${known.join(', ') || 'none (processor unreachable)'}`, detail);
        }
    }
    try {
        if (source === null) {
            await env.ESPN_API_CACHE.delete(overrideKey(league, id));
        } else {
            const value: SourceOverride = { source, actor: context.locals.adminActor ?? 'admin-cookie', set_at: new Date().toISOString() };
            // no expirationTtl: a pin lasts until it is removed
            await env.ESPN_API_CACHE.put(overrideKey(league, id), JSON.stringify(value), { metadata: value });
        }
    } catch (e: any) {
        auditAdmin(context.locals, 'source-override', detail, false);
        return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500, headers: NO_STORE });
    }
    // The page and its card were rendered from the old source: drop them so the
    // next request follows the pin. The pin itself is written either way, so
    // `ok` stays true; a failed purge is reported (`purged: false`, shown by both
    // admin clients) and audited as not ok, with the fix: Purge on /admin.
    const page = leaguePath(league, `/game/${id}`);
    let purged = true;
    try {
        await context.cache.invalidate({ path: page });
        await context.cache.invalidate({ path: `${page}/card.png` });
    } catch { purged = false; }
    context.cache.set(false);
    auditAdmin(context.locals, 'source-override', purged ? detail : `${detail} (page purge failed)`, purged);
    return Response.json({ ok: true, league, id, source, purged }, { headers: NO_STORE });
};
