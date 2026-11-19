import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { auditAdmin } from '../../../utils/telemetry';
import { settledKey } from '../../../resources/python';
import { BASKETBALL_LEAGUES, PREFIXED_LEAGUES, leaguePath, type League } from '../../../utils/league';

/** every league with game pages: an id is purged under each, since the caller need not say which */
const GAME_LEAGUES: readonly League[] = ['cfb', ...PREFIXED_LEAGUES];

export const prerender = false;

// Purge cached pages from inside the Worker. Workers Caching is scoped to the
// Worker: no zone-level purge (dashboard, API, Terraform) reaches it, only
// ctx.cache.purge -- which Astro exposes as cache.invalidate. Behind /admin
// basic auth.
//   ?tags=game-completed          every final game page (after a parser fix)
//   ?ids=401856766,401864570      specific games (also resets their regression mark)
// Both may be combined. The API-layer response cache is keyed on PROCESSOR_VERSION,
// so a deploy that changes python/ or sportsdataverse-py main already invalidates it;
// this only has to clear the rendered pages, and an id's settled-final copy in R2.
// A tag cannot reach those copies: bump python/CACHE_GENERATION to re-key them all.
const KNOWN_TAGS = new Set(['game-completed', 'game-in-progress', 'game-scheduled-today',
    'game-scheduled-future', 'scoreboard', 'matchup', 'favorites-enabled',
    // week/schedule + chart pages (see the tags: lists in utils/config.ts and pages/)
    'week-complete', 'week-in-progress', 'week-scheduled-current-week',
    'week-scheduled-current-season', 'chart',
    // every individual player page (routes/player.ts), after a producer republish
    'player',
    // /year/* and /team/* (route rules in astro.config.mjs, 3-day maxAge) and the teams
    // index pages: without these a summaries republish waits out the TTL or a redeploy
    'season', 'team', 'teams-index',
    // the /trends, /charts/* and /teams, /players route rules (astro.config.mjs)
    'charts', 'leaderboards',
    // every share card (routes/shareCard.ts caches each under it)
    'share-card',
    // every basketball page of one league (routes/basketball/cache.ts, game.ts, scoreboard.ts tag each with its slug)
    ...BASKETBALL_LEAGUES,
    // /sitemap-index.xml and the player sitemaps, after a flag promotion changes what they list
    'sitemap']);

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
            // An ESPN game id belongs to one league, but the caller need not say
            // which: purging the other leagues' paths and marks is a harmless miss.
            for (const lg of GAME_LEAGUES) {
                const page = leaguePath(lg, `/game/${id}`);
                await context.cache.invalidate({ path: page });
                // and its share card, which caches for up to a year once final: a re-purge
                // after a source pin changes (utils/sourceOverride.ts) has to reach it too
                await context.cache.invalidate({ path: `${page}/card.png` });
                // A forced refresh also resets the regression guard's high-water mark
                // (resources/espn.ts, gamestate:<league:>id): a stale or inflated mark makes
                // every honest payload "regress", which renders the page uncached on every request.
                await env.ESPN_API_CACHE.delete(`gamestate:${lg === 'cfb' ? '' : `${lg}:`}${id}`);
            }
            // and a settled final's processed payload, which no deploy re-keys (resources/python.ts settledKey).
            // Only football keeps one today; the basketball keys are a harmless miss that keeps a future one covered.
            await (env as any).PRO_BUCKET?.delete(GAME_LEAGUES.map((lg) => settledKey(lg, id)));
            results[id] = 'purged';
        } catch (e: any) {
            results[id] = `error: ${e?.message ?? e}`;
        }
    }
    context.cache.set(false);
    const allOk = Object.values(results).every((v) => v === 'purged');
    auditAdmin(context.locals, 'purge-game',
        `ids=[${ids.join(',')}] tags=[${tags.join(',')}]`, allOk);
    return Response.json({ ok: allOk, results },
        { headers: { 'Cache-Control': 'no-store' } });
}
