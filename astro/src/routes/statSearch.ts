/**
 * Page-side step of the stat-threshold search (`/search/seasons` and the /nfl twin, S15):
 * the filters, the read and the cache policy, run in the page frontmatter while the
 * response headers are open. Both pages render components/search/SeasonSearchPage.astro.
 */
import type { AstroGlobal } from 'astro';
import { parseStatFilters } from '../utils/statSearch';
import { retrievePlayerSeasonsWide, type SDVPlayerSeasonWide } from '../resources/sdv';

/** The season boards' policy: the table moves when a season does. */
export const STAT_SEARCH_CACHE = { maxAge: 60 * 60 * 24, tags: ['season'] };

export interface StatSearchLoad {
    filters: Record<string, number>
    /** undefined: no filters, so no read; null: the read failed */
    rows: SDVPlayerSeasonWide[] | null | undefined
}

/**
 * A failed read is never cached: `cache.set(false)` emits no header and Workers Caching
 * holds a header-less 200 for ~2 hours (routes/game.ts), so it opts out explicitly.
 */
export async function loadStatSearch(Astro: AstroGlobal, league: 'cfb' | 'nfl'): Promise<StatSearchLoad> {
    Astro.locals.league = league;
    const filters = parseStatFilters(Astro.url.searchParams);
    const rows = Object.keys(filters).length ? await retrievePlayerSeasonsWide({ filters, league }) : undefined;
    try { (Astro as any).cache?.set(rows === null ? false : STAT_SEARCH_CACHE); } catch { /* cache provider absent in dev */ }
    if (rows === null) {
        try { Astro.response?.headers?.set('Cache-Control', 'no-store'); } catch { /* as above */ }
    }
    return { filters, rows };
}
