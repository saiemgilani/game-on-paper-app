/** The season pages' one read: the season's player rows, with the cache decision made here. */
import type { AstroGlobal } from 'astro';
import { retrieveSeasonPlayerRows, type SeasonPlayerRow } from '../../resources/nbaShots';
import { SEASON_CACHE, setCache, uncacheable } from './cache';

/**
 * Reads the season's shot_season_players rows for a season page and settles its cache policy:
 * a failed read is uncacheable and returns null (the page answers 503); an empty season is
 * uncacheable (not ingested yet: never hold the empty page for the season window); otherwise
 * SEASON_CACHE. `route` names the page in the error log. A page that can still turn the read into
 * a 404 passes `cacheOnSuccess = false` and sets SEASON_CACHE itself once it knows it will render.
 */
export async function readSeasonRows(Astro: AstroGlobal, season: number, route: string, cacheOnSuccess = true): Promise<SeasonPlayerRow[] | null> {
    let rows: SeasonPlayerRow[];
    try {
        rows = await retrieveSeasonPlayerRows(season);
    } catch (e: any) {
        console.error(`ERROR while loading the ${season} season players for ${route}: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return null;
    }
    if (rows.length === 0) uncacheable(Astro);
    else if (cacheOnSuccess) setCache(Astro, SEASON_CACHE);
    return rows;
}
