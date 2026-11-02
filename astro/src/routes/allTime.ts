/**
 * Page-side step of the all-time player leaderboards (`/all-time/players/[category]`
 * and the /nfl twin, S17): the category check and the sort. Both leagues' pages call
 * this and render `components/leaderboards/AllTimePage.astro`, which reuses the
 * season board's table.
 */
import type { AstroGlobal } from 'astro';
import type { League } from '../utils/league';
import { PLAYER_LEADERBOARD_CATEGORIES } from '../utils/seo';
import { SDV_PLAYER_METRIC_CATEGORIES } from '../utils/constants';

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

/** The all-time boards' URLs, both leagues: the namespace the 'all-time-leaderboards' flag gates. */
export function isAllTimePath(pathname: string): boolean {
    const p = pathname === '/nfl' || pathname.startsWith('/nfl/') ? pathname.slice(4) || '/' : pathname;
    return /^\/all-time(\/|$)/.test(p);
}

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
