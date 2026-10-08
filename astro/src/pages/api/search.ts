import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { env } from 'cloudflare:workers';
import { isFeatureEnabled } from '../../utils/features';
import { safeCachePut } from '../../utils/misc';
import { rankHits, searchQuery, type SearchRow } from '../../utils/search';
import { wrappedFetch } from '../../utils/telemetry';

export const prerender = false;

const UPSTREAM = 'https://data.sportsdataverse.org/v1/search';
const TYPES = 'team,player,game';
const TTL = 60 * 60;
// Every answer depends on the viewer (the flag gate and the per-viewer drops), and Workers
// Caching holds a header-less 200 for a heuristic 2 h, so no response may enter it.
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/search?q=&league= : the header search's proxy to the Data API's entity search,
 * which needs the bearer token and locks CORS. The upstream rows are held in KV for an hour
 * per (league, query); what this viewer may follow is decided after the cache. A bad query,
 * an unknown league or any upstream failure answers [], never the upstream's own message.
 */
export const GET: APIRoute = async ({ url, locals }) => {
    if (!isFeatureEnabled('site-search', locals)) return new Response(null, { status: 404, headers: NO_STORE });
    const q = searchQuery(url.searchParams.get('q'));
    const league = url.searchParams.get('league') ?? 'cfb';
    const nfl = isFeatureEnabled('nfl', locals);
    if (!q || (league !== 'cfb' && league !== 'nfl') || (league === 'nfl' && !nfl)) return json([]);
    const rows = await upstream(q, league);
    return json(rankHits(rows, { players: isFeatureEnabled('player-pages', locals), nfl }));
};

async function upstream(q: string, league: string): Promise<SearchRow[]> {
    const key = `search:${league}:${q.toLowerCase()}`;
    try {
        // a KV failure is a cache miss, not an empty answer
        const cached = await env.SDV_API_CACHE.get(key, 'json').catch(() => null);
        if (Array.isArray(cached)) return cached;
        const res = await wrappedFetch(`${UPSTREAM}?${new URLSearchParams({ q, league, types: TYPES })}`, {
            headers: { Authorization: `Bearer ${getSecret('SDV_AUTH_TOKEN') ?? ''}` },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const rows = await res.json();
        if (!Array.isArray(rows)) throw new Error('not an array');
        await safeCachePut(env.SDV_API_CACHE, key, JSON.stringify(rows), TTL);
        return rows;
    } catch (e) {
        console.warn(`site search: upstream failed for ${league}: ${e}`);
        return [];
    }
}

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', ...NO_STORE } });
}
