/**
 * Stat-threshold search (S15): `/search/seasons?pass_yards=3000&rush_yards=1000` and the
 * /nfl twin, over the Data API's `{league}.player_seasons_wide` (sdv-db F11: one row per
 * player-season, box-score totals). Kept free of the Data API client so the middleware
 * can import the path gate.
 *
 * The whitelist is the only thing standing between the query string and the API: the
 * generic table route ANSWERS 200 to an unknown `<col>__gte` and ignores it (checked
 * 2026-11-02), so an unlisted key would silently return unfiltered rows.
 */
export const STAT_FILTERS: Record<string, string> = {
    pass_yards: 'Pass Yds',
    pass_td: 'Pass TD',
    rush_yards: 'Rush Yds',
    rush_td: 'Rush TD',
    rec: 'Catches',
    rec_yards: 'Rec Yds',
    rec_td: 'Rec TD',
    scrimmage_yards: 'Scrimmage Yds',
};

export const STAT_SEARCH_LIMIT = 200;

/** A threshold is a whole number of at most six digits, what the form's `min=0 step=1` field submits. */
const THRESHOLD_RE = /^\d{1,6}$/;

/**
 * Whitelisted keys holding a whole, non-negative number, in STAT_FILTERS order (so the cache key and the sort
 * don't follow param order). Anything else (a decimal, `1e3`, `0x10`, a sign, a seven-digit value) is dropped:
 * `Number()` alone let `1e21` through as the string `1e+21`, which the API may refuse, and the page would then
 * say the search is unavailable instead of "no seasons".
 */
export function parseStatFilters(q: URLSearchParams): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of Object.keys(STAT_FILTERS)) {
        const raw = q.get(key)?.trim();
        if (raw && THRESHOLD_RE.test(raw)) out[key] = Number(raw);
    }
    return out;
}

/** One `<col>__gte` per filter, the first filter descending, capped at STAT_SEARCH_LIMIT. */
export function statSearchQuery(filters: Record<string, number>): Record<string, string> {
    const keys = Object.keys(filters);
    const q: Record<string, string> = {};
    for (const k of keys) q[`${k}__gte`] = String(filters[k]);
    q.order = `-${keys[0]}`;
    q.limit = String(STAT_SEARCH_LIMIT);
    return q;
}

export function isStatSearchPath(pathname: string): boolean {
    return /^(\/nfl)?\/search\/seasons\/?$/.test(pathname);
}
