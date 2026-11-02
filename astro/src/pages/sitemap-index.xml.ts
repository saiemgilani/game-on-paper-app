import type { APIRoute } from 'astro';
import { retrievePlayerSitemapIds } from '../resources/sdv';
import { LEAGUES } from '../utils/league';
import { playerSitemapFiles, playerSitemapLeagues, sitemapIndexXml } from '../utils/sitemap';

/**
 * The sitemap index robots.txt points at: the prerendered `/sitemap.xml` (every
 * page the site can list from local data) plus the player sitemaps, which need
 * the Data API's ids and so cannot be prerendered.
 *
 * SSR, and a crawler asking for it costs at most one round of season reads: the
 * ids sit in KV under each table's ingest stamp (shared with the player files,
 * which read the same URLs), and the index itself is held in Workers Caching for
 * a day. A failed read is a 503 that is never cached -- an index missing a
 * season's files would read as "those pages are gone".
 */
export const prerender = false;

const CACHE = { maxAge: 60 * 60 * 24, swr: 60 * 60 * 24, tags: ['sitemap'] };

export const GET: APIRoute = async (context) => {
    const files = [{ loc: '/sitemap.xml', lastmod: new Date().toISOString().slice(0, 10) }];
    try {
        for (const league of playerSitemapLeagues()) {
            files.push(...playerSitemapFiles(league, await retrievePlayerSitemapIds(league, LEAGUES[league].seasons)));
        }
    } catch (e) {
        console.error(`sitemap index: player ids unavailable: ${e}`);
        try { (context as any).cache?.set(false); } catch { /* cache provider absent in dev */ }
        return new Response('Sitemap temporarily unavailable.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300' },
        });
    }
    try { (context as any).cache?.set(CACHE); } catch { /* cache provider absent in dev */ }
    return new Response(sitemapIndexXml(files), {
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
};
