/**
 * The Workers cache keys every response on its path and query string, so any query parameter, even one no
 * page reads (`?x=1`, a `utm_*`, the stat card's day bucket `v`), was a fresh miss and a full render (#480).
 * worker.ts hands every page request to the cached `Site` entrypoint through `keyedRequest`, which keeps only
 * the parameters below, in name order. The page then renders from the URL it is keyed on, so a parameter
 * missing here stops working (a page renders its default) but can never be served under another URL's key.
 *
 * Global, not per route: one name list is far smaller than a table of ~60 routes, and a name kept for a route
 * that ignores it only costs that route the miss it already had. test/cacheKey.test.ts scans src/ for every
 * literal searchParams read and fails when one is missing here.
 */
import { STAT_FILTERS } from './statSearch';

export const CACHE_KEY_PARAMS: ReadonlySet<string> = new Set([
    // seasons and pickers, read across the football and basketball routes
    'season', 'team', 'player', 'conference', 'group', 'date', 'view', 'poll',
    // sortable tables and leaderboards (utils/leaderboards.ts parseControls, routes/basketball/*)
    'sort', 'dir', 'mode', 'board', 'basis', 'unit', 'impact', 'qualified', 'min', 'lsort', 'ldir',
    // basketball team and player splits
    'situation', 'games', 'onoff', 'wowy', 'side',
    // lineup shot chart (routes/basketball/lineupShots.ts)
    'p', 's', 'op', 'os',
    // shot chart filters (basketball/shotFilters.ts), shift chart, plays order, garbage time
    'shot_team', 'shot_player', 'shot_period', 'shot_result', 'shot_zone', 'shot_type', 'shot_move', 'shot_assist',
    'shot_on', 'shot_off', 'shift_on', 'order', 'garbage',
    // best games, compare, the matchup builder, the chart builder
    'from', 'to', 'ids', 'awaySeason', 'awayTeamId', 'homeSeason', 'homeTeamId', 'x', 'y', 'hl',
    // game pages and share cards
    'spoilers', 'state', 'variant',
    // /api/search
    'q', 'league', 'type',
    // admin view, flag override and source switch (utils/adminView.ts), preview links (utils/preview.ts)
    'flags', 'source', 'preview_key',
    // the stat search form (utils/statSearch.ts)
    ...Object.keys(STAT_FILTERS),
]);

/** Left exactly as requested: Astro's own endpoints (server islands, actions, images) and the private,
 *  uncached /admin and /pro trees, which read or forward query strings wholesale. */
const UNKEYED = /^\/(_|admin(\/|$)|pro(\/|$))/;

/** The request the cached entrypoint sees: unread query parameters dropped, the rest in name order. */
export function keyedRequest(request: Request): Request {
    if (request.method !== 'GET' && request.method !== 'HEAD') return request;
    const url = new URL(request.url);
    if (!url.search || UNKEYED.test(url.pathname)) return request;
    // sort is stable, so a repeated name (`?p=1&p=2`) keeps its order
    const kept = [...url.searchParams].filter(([k]) => CACHE_KEY_PARAMS.has(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    url.search = new URLSearchParams(kept).toString();
    return new Request(url, request);
}
