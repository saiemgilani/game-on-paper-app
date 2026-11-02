/**
 * Page-side step of the all-time player leaderboards (`/all-time/players/[category]`
 * and the /nfl twin, S17): the category check, the sort, the read and the cache
 * policy. Both leagues' pages call `loadAllTime` and render
 * `components/leaderboards/AllTimePage.astro`, which reuses the season board's table.
 * The namespace gate (`isAllTimePath`) lives in utils/players.ts, beside isPlayerPath,
 * so the middleware never imports the Data API client.
 */
import type { AstroGlobal } from 'astro';
import type { League } from '../utils/league';
import { PLAYER_LEADERBOARD_CATEGORIES } from '../utils/seo';
import { SDV_PLAYER_METRIC_CATEGORIES } from '../utils/constants';
import { retrieveAllTimePlayerSeasons, sdvIngestStamp, sdvPin, type SDVPlayerSummary, type SummaryType } from '../resources/sdv';
import { freshnessStamp } from '../utils/freshness';

/**
 * The first season each league's player tables hold a qualified row for. Checked
 * 2026-11-01 against the Data API, the same answer for every category:
 *   curl -H "Authorization: Bearer $KEY" \
 *     "https://data.sportsdataverse.org/v1/<cfb|nfl>/<passing|rushing|receiving>?select=season&order=season&TEPA_rank__gte=1&limit=1"
 * The last season is METRIC_YEAR, the newest season the site ranks.
 */
export const ALL_TIME_SPAN: Record<'cfb' | 'nfl', Record<string, number>> = {
    cfb: { passing: 2004, rushing: 2004, receiving: 2004 },
    nfl: { passing: 1999, rushing: 1999, receiving: 1999 },
};

export const ALL_TIME_DEFAULT_METRIC = 'TEPA';

export type AllTimePrep = { notFound: true } | { category: string; metric: string };

// An unknown category is a 404 (as on the season boards); a `?sort=` the category does
// not have falls back to the default, since it would name a column the API rejects.
export function prepareAllTime(Astro: AstroGlobal, league: League): AllTimePrep {
    Astro.locals.league = league;
    const { category } = Astro.params;
    if (!category || !PLAYER_LEADERBOARD_CATEGORIES.includes(category)) {
        return { notFound: true };
    }
    const sort = Astro.url.searchParams.get('sort');
    const metric = sort && Object.hasOwn(SDV_PLAYER_METRIC_CATEGORIES[category], sort) ? sort : ALL_TIME_DEFAULT_METRIC;
    return { category, metric };
}

/** The season boards' policy (astro.config.mjs routeRules "/year/[...slug]"): the board moves when a season does. */
export const ALL_TIME_CACHE = { maxAge: 60 * 60 * 24 * 3, tags: ['season'] };

export type AllTimeLoad = { notFound: true } | {
    category: string;
    metric: string;
    /** null: the read failed, and the page says the board is unavailable */
    rows: SDVPlayerSummary[] | null;
    stamp: ReturnType<typeof freshnessStamp> | null;
};

/**
 * The route check, the read and the cache policy, run in the page frontmatter while the
 * response headers are still open. A failed read is never cached: `cache.set(false)`
 * emits no header, and Workers Caching holds a header-less 200 for ~2 hours
 * (routes/game.ts), so one Data API timeout would serve "unavailable" to everyone.
 * Opting out is explicit, as routes/player.ts `uncacheable` does it.
 */
export async function loadAllTime(Astro: AstroGlobal, league: 'cfb' | 'nfl'): Promise<AllTimeLoad> {
    const r = prepareAllTime(Astro, league);
    if ('notFound' in r) return r;
    const pin = sdvPin(await sdvIngestStamp(league, r.category));
    const rows = await retrieveAllTimePlayerSeasons({ category: r.category as SummaryType, metric: r.metric, league, pin });
    try { (Astro as any).cache?.set(rows === null ? false : ALL_TIME_CACHE); } catch { /* cache provider absent in dev */ }
    if (rows === null) {
        try { Astro.response?.headers?.set('Cache-Control', 'no-store'); } catch { /* as above */ }
    }
    return { ...r, rows, stamp: pin?.held ? freshnessStamp(pin.version) : null };
}
