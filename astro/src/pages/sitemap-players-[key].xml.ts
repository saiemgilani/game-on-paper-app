import type { APIRoute } from 'astro';
import { retrievePlayerSitemapIds } from '../resources/sdv';
import {
    careerPlayerEntries, pageSlice, parsePlayerSitemapKey, seasonPlayerEntries, urlsetXml,
} from '../utils/sitemap';

/**
 * `/sitemap-players-<league>-<season|career>-<page>.xml`, the player sitemaps
 * `/sitemap-index.xml` lists. At the site root on purpose: a sitemap may only
 * list URLs at or below its own directory, so one under `/sitemaps/` could not
 * list `/players/...`.
 *
 * A season file lists `/players/<id>?season=<year>`; the career files list each
 * player's bare `/players/<id>` once. Every file reads the league's ids whole --
 * the same few KV-cached reads the index makes, so a file costs no more than it. Same cache rules as the index: a day in
 * Workers Caching, and a failed read is an uncached 503.
 */
export const prerender = false;

const CACHE = { maxAge: 60 * 60 * 24, swr: 60 * 60 * 24, tags: ['sitemap'] };

function uncached(status: number, text: string): Response {
    return new Response(text, {
        status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '300' } : {}) },
    });
}

export const GET: APIRoute = async (context) => {
    const noCache = () => { try { (context as any).cache?.set(false); } catch { /* cache provider absent in dev */ } };
    const key = parsePlayerSitemapKey(context.params.key);
    if (!key) { noCache(); return uncached(404, 'Not found'); }

    let ids: Map<number, string[]>;
    try {
        ids = await retrievePlayerSitemapIds(key.league);
    } catch (e) {
        console.error(`player sitemap ${context.params.key}: player ids unavailable: ${e}`);
        noCache();
        return uncached(503, 'Sitemap temporarily unavailable.');
    }
    const entries = key.season === 'career'
        ? careerPlayerEntries(key.league, ids)
        : seasonPlayerEntries(key.league, key.season, ids.get(key.season) ?? []);
    // past the last page (or a season with no players) is a file the index never lists
    const page = pageSlice(entries, key.page);
    if (!page) { noCache(); return uncached(404, 'Not found'); }

    try { (context as any).cache?.set(CACHE); } catch { /* cache provider absent in dev */ }
    return new Response(urlsetXml(page), {
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
};
