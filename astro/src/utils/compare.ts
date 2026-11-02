/**
 * Player compare (`/players/compare`, `/nfl/players/compare`, behind 'player-compare'): the
 * players are the `?ids=` list, so a comparison is a URL anyone can share, and adding or
 * removing a player is a link to the same list with one id more or less.
 *
 * Each card shows one season per player: `?season=` when given, else that player's latest.
 * Every card lists the same categories and the same metrics in the same order, so a row
 * lines up across cards and a player with no line in a category shows dashes, not a gap.
 */
import { leaguePath, type League } from './league';
import { isEspnAthleteId, PLAYER_CATEGORIES, type PlayerCategory, type SeasonRow } from './players';

/** Four cards fill a desktop row (col-lg-3). */
export const MAX_COMPARE = 4;

/**
 * The `?ids=` list: comma-separated ESPN athlete ids, deduped, at most MAX_COMPARE, anything
 * else dropped. ESPN ids only: they are what the player pages, the search hits and the Data
 * API's player routes key on (an NFL gsis id would need a crosswalk read per id).
 */
export function parseCompareIds(raw: string | null | undefined): string[] {
    const ids = (raw ?? '').split(',').map((s) => s.trim()).filter(isEspnAthleteId);
    return [...new Set(ids)].slice(0, MAX_COMPARE);
}

/** The compare page for these ids (and season, when one is picked). */
export function compareHref(league: League | undefined, ids: string[], season?: number | null): string {
    const q = new URLSearchParams();
    if (ids.length > 0) q.set('ids', ids.join(','));
    if (season) q.set('season', String(season));
    const qs = q.toString().replaceAll('%2C', ',');
    return leaguePath(league, '/players/compare') + (qs ? `?${qs}` : '');
}

/** The season a card shows: the one asked for, else the player's latest with rows. */
export function cardSeason(rows: SeasonRow[], season: number | null): number | null {
    if (season !== null) return season;
    const years = rows.map((r) => Number(r.season)).filter(Number.isFinite);
    return years.length > 0 ? Math.max(...years) : null;
}

/**
 * A card's line per category for its season: the busiest team-season row when he was traded,
 * the row the player page's header describes too. Its ranks and percentiles are that row's own.
 */
export function cardLines(rows: SeasonRow[], season: number | null): Partial<Record<PlayerCategory, SeasonRow>> {
    const out: Partial<Record<PlayerCategory, SeasonRow>> = {};
    for (const c of PLAYER_CATEGORIES) {
        const best = rows
            .filter((r) => r.category === c && Number(r.season) === season)
            .toSorted((a, b) => Number(b.plays ?? 0) - Number(a.plays ?? 0))[0];
        if (best) out[c] = best;
    }
    return out;
}

/** The categories any card has a line in, in the page's order. */
export function compareCategories(lines: Partial<Record<PlayerCategory, SeasonRow>>[]): PlayerCategory[] {
    return PLAYER_CATEGORIES.filter((c) => lines.some((l) => l[c]));
}
