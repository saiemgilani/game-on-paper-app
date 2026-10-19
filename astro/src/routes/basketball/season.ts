/** The season pages' shared steps: which season a page shows, and the season's player rows with the cache decision made here. */
import type { AstroGlobal } from 'astro';
import { seasonQuery } from '../../nba/links';
import { parseSeason } from '../../nba/seasons';
import { retrieveSeasonPlayerRows, type SeasonPlayerRow } from '../../resources/nbaShots';
import { BASKETBALL } from '../../basketball/config';
import { LEAGUES, type BasketballLeague } from '../../utils/league';
import { seasonCache, setCache, uncacheable } from './cache';

/** The season a page shows, from `?season=` against the league's listed seasons. */
export function resolveBasketballSeason(Astro: AstroGlobal, league: BasketballLeague): { season: number; seasons: number[]; current: number; q: string } {
    const first = BASKETBALL[league].shotFirstSeason;
    // the NBA's getter is range(FIRST_SEASON, LAST_KNOWN_SEASON) == siteSeasons(); a league with shotFirstSeason lists its dashboard seasons only
    const seasons = first === undefined ? LEAGUES[league].seasons : LEAGUES[league].seasons.filter((s) => s >= first);
    const current = seasons[seasons.length - 1];
    const season = parseSeason(Astro.url.searchParams.get('season'), seasons);
    return { season, seasons, current, q: seasonQuery(season, current) };
}

/**
 * Reads the season's shot_season_players rows for a season page and settles its cache policy:
 * a failed read is uncacheable and returns null (the page answers 503); an empty season is
 * uncacheable (not ingested yet: never hold the empty page for the season window); otherwise
 * seasonCache(league). `route` names the page in the error log. A page that can still turn the read
 * into a 404 passes `cacheOnSuccess = false` and sets the season cache itself once it knows it will render.
 */
export async function readBasketballSeasonRows(Astro: AstroGlobal, league: BasketballLeague, season: number, route: string, cacheOnSuccess = true): Promise<SeasonPlayerRow[] | null> {
    let rows: SeasonPlayerRow[];
    try {
        rows = await retrieveSeasonPlayerRows(season, league);
    } catch (e: any) {
        console.error(`ERROR while loading the ${season} season players for ${route}: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return null;
    }
    if (rows.length === 0) uncacheable(Astro);
    else if (cacheOnSuccess) setCache(Astro, seasonCache(league));
    return rows;
}
