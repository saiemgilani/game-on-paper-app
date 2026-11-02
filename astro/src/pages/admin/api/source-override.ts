import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { retrieveGameSources } from '../../../resources/python';
import { cardKey } from '../../../routes/shareCard';
import { leaguePath, type League } from '../../../utils/league';
import { CARD_VARIANTS } from '../../../utils/shareTags';
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
// rendered page and share card so the next render follows it.
const NO_STORE = { 'Cache-Control': 'no-store' };

export const GET: APIRoute = async () => {
    try {
        const keys: { name: string; metadata?: unknown }[] = [];
        let cursor: string | undefined;
        do {
            const page: any = await env.ESPN_API_CACHE.list({ prefix: OVERRIDE_PREFIX, cursor });
            keys.push(...page.keys);
            cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor && keys.length < 2000);
        const overrides = keys.map((k) => {
            const [league, game_id] = k.name.slice(OVERRIDE_PREFIX.length).split(':');
            return { league, game_id, ...((k.metadata ?? {}) as Partial<SourceOverride>) };
        });
        return Response.json({ ok: true, overrides }, { headers: NO_STORE });
    } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500, headers: NO_STORE });
    }
};

export const POST: APIRoute = async (context) => {
    let body: { league?: unknown; id?: unknown; source?: unknown } = {};
    try { body = (await context.request.json()) ?? {}; } catch { /* no body */ }
    const league = body.league as League;
    const id = String(body.id ?? '');
    const source = body.source;
    const bad = (error: string) => Response.json({ ok: false, error }, { status: 400, headers: NO_STORE });
    if (!OVERRIDE_LEAGUES.includes(league)) return bad(`league must be one of ${OVERRIDE_LEAGUES.join(', ')}`);
    if (!/^\d{6,12}$/.test(id)) return bad('id must be an ESPN game id');
    if (source !== null && typeof source !== 'string') return bad('source must be a source name, or null to remove the pin');
    if (source === 'espn') return bad('espn is the default: remove the pin instead');

    const detail = `${league}:${id} ${source ?? 'removed'}`;
    if (source !== null) {
        const known = (await retrieveGameSources(id, league))?.sources ?? [];
        if (!known.includes(source)) {
            auditAdmin(context.locals, 'source-override', `${detail} (rejected)`, false);
            return bad(`unknown source ${source} for ${league}; known: ${known.join(', ') || 'none (processor unreachable)'}`);
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
    // next request follows the pin. Best effort -- the pin itself is written.
    const page = leaguePath(league, `/game/${id}`);
    let purged = true;
    try {
        await context.cache.invalidate({ path: page });
        await context.cache.invalidate({ path: `${page}/card.png` });
    } catch { purged = false; }
    await Promise.all((['live', 'final'] as const).flatMap((state) => CARD_VARIANTS.map((variant) =>
        env.ESPN_API_CACHE.delete(cardKey(league, id, state, variant)).catch(() => { purged = false; }))));
    context.cache.set(false);
    auditAdmin(context.locals, 'source-override', detail, true);
    return Response.json({ ok: true, league, id, source, purged }, { headers: NO_STORE });
};
