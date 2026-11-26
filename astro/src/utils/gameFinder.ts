/**
 * The basketball game finder's URL (BB-G57): `/<league>/games/find?pts=40&reb=10&from=2020&to=2026&type=2&ha=home&res=W&unit=player`,
 * and the Data API query it becomes (sdv-db's `/v1/<league>/game_finder`, BB-D41). Pure, so the page and the tests share it.
 *
 * Every threshold is "at least N". The whitelist is the only thing between the query string and the API; the route answers 400 to
 * an unknown key, so an unlisted one would turn the page into "unavailable" rather than a quiet unfiltered list, and is dropped here.
 */

export type FinderUnit = 'player' | 'team';

/** Threshold keys (the API's stat keys) and their column labels, in the form's order. `min` is on the player box only. */
export const FINDER_STATS: Record<string, { label: string; title: string; units: readonly FinderUnit[] }> = {
    pts: { label: 'PTS', title: 'Points', units: ['player', 'team'] },
    reb: { label: 'REB', title: 'Rebounds', units: ['player', 'team'] },
    ast: { label: 'AST', title: 'Assists', units: ['player', 'team'] },
    stl: { label: 'STL', title: 'Steals', units: ['player', 'team'] },
    blk: { label: 'BLK', title: 'Blocks', units: ['player', 'team'] },
    fg3m: { label: '3PM', title: 'Three-pointers made', units: ['player', 'team'] },
    ftm: { label: 'FTM', title: 'Free throws made', units: ['player', 'team'] },
    tov: { label: 'TOV', title: 'Turnovers', units: ['player', 'team'] },
    min: { label: 'MIN', title: 'Minutes', units: ['player'] },
};

/** The rows the page asks for and the count rows it shows (the API caps them at 500 and 200). */
export const FINDER_ROWS = 100;
export const FINDER_COUNTS = 25;

/** A threshold is a whole number of at most four digits, what the form's `min=0 step=1` field submits. */
const THRESHOLD_RE = /^\d{1,4}$/;

export interface FinderFilter {
    unit: FinderUnit;
    /** stat key -> at least this, in FINDER_STATS order */
    stats: Record<string, number>;
    from: number;
    to: number;
    /** ESPN's season type: 2 regular season, 3 postseason; null both */
    type: 2 | 3 | null;
    homeAway: 'home' | 'away' | null;
    result: 'W' | 'L' | null;
}

const pick = <T extends string>(raw: string | null, allowed: readonly T[]): T | null => (allowed.includes(raw as T) ? (raw as T) : null);

/**
 * The filter a URL asks for. Seasons outside the league's list fall back to the current one, and a reversed range is put in
 * order; a threshold the unit lacks, a non-integer or an unknown key is dropped.
 */
export function parseFinder(q: URLSearchParams, seasons: readonly number[], current: number): FinderFilter {
    const unit = pick(q.get('unit'), ['player', 'team'] as const) ?? 'player';
    const stats: Record<string, number> = {};
    for (const [key, s] of Object.entries(FINDER_STATS)) {
        const raw = q.get(key)?.trim();
        if (raw && THRESHOLD_RE.test(raw) && s.units.includes(unit)) stats[key] = Number(raw);
    }
    const season = (raw: string | null) => (seasons.includes(Number(raw)) ? Number(raw) : current);
    const a = season(q.get('from'));
    const b = season(q.get('to'));
    const type = q.get('type') === '2' ? 2 : q.get('type') === '3' ? 3 : null;
    return { unit, stats, from: Math.min(a, b), to: Math.max(a, b), type, homeAway: pick(q.get('ha'), ['home', 'away'] as const), result: pick(q.get('res'), ['W', 'L'] as const) };
}

/** The API query: one `<stat>__gte` per threshold, the first threshold descending (newest first among ties). */
export function finderQuery(f: FinderFilter): Record<string, string> {
    const q: Record<string, string> = { unit: f.unit, season_from: String(f.from), season_to: String(f.to) };
    for (const [k, v] of Object.entries(f.stats)) q[`${k}__gte`] = String(v);
    if (f.type) q.season_type = String(f.type);
    if (f.homeAway) q.home_away = f.homeAway;
    if (f.result) q.result = f.result;
    const first = Object.keys(f.stats)[0];
    q.order = first ? `-${first}` : '-game_date';
    q.limit = String(FINDER_ROWS);
    q.counts_limit = String(FINDER_COUNTS);
    return q;
}

/** The page's own URL for a filter, defaults left off (the player unit, the current season, both season types). */
export function finderHref(path: string, f: FinderFilter, current: number): string {
    const q = new URLSearchParams();
    if (f.unit !== 'player') q.set('unit', f.unit);
    for (const [k, v] of Object.entries(f.stats)) q.set(k, String(v));
    if (f.from !== current || f.to !== current) { q.set('from', String(f.from)); q.set('to', String(f.to)); }
    if (f.type) q.set('type', String(f.type));
    if (f.homeAway) q.set('ha', f.homeAway);
    if (f.result) q.set('res', f.result);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
}

/** "40+ PTS, 10+ REB": the thresholds in words, for the heading and the counts column. */
export function thresholdLabel(stats: Record<string, number>): string {
    return Object.entries(stats).map(([k, v]) => `${v}+ ${FINDER_STATS[k].label}`).join(', ');
}
