/**
 * Workers Caching policy for the /nba pages, the way routes/player.ts owns the football
 * player page's: the loaders set it, because by the time a component's reads settle the
 * response headers are gone. A degraded or missing page is never cached (a header-less 200
 * would be held ~2 h by the heuristic), so opting out is explicit.
 */
import type { AstroGlobal } from 'astro';

/** Season-level pages follow the nightly ingest; tagged so /admin/api/purge-game?tags=nba clears them. */
export const SEASON_CACHE = { maxAge: 6 * 60 * 60, swr: 6 * 60 * 60, tags: ['nba'] };
/** A player's page: the football player page's policy. */
export const PLAYER_CACHE = { maxAge: 60 * 60, swr: 6 * 60 * 60, tags: ['nba'] };

export function setCache(Astro: AstroGlobal, config: { maxAge: number; swr?: number; tags: string[] } | false): void {
    try { (Astro as any).cache?.set(config); } catch { /* cache provider absent in dev */ }
}

export function uncacheable(Astro: AstroGlobal): void {
    setCache(Astro, false);
    try { Astro.response?.headers?.set('Cache-Control', 'no-store'); } catch { /* as above */ }
}

/** The answer to a Data API read that failed: a 503 monitoring can see, never a 404. */
export const NBA_UNAVAILABLE = (): Response => new Response(
    'NBA shot data is temporarily unavailable. Please try again shortly.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' } },
);
