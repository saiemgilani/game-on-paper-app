/**
 * Page-side step of /<league>/games/find for the four basketball leagues (BB-G57, behind 'bball-game-finder'): the filter from the
 * URL (utils/gameFinder.ts), then one read of sdv-db's game finder (resources/gameFinder.ts). The totals, the games-per-player
 * counts and the rows are the producer's (rule B6); nothing is counted here. No threshold, no read: the page shows the form.
 */
import type { AstroGlobal } from 'astro';
import { retrieveGameFinder, type FinderBody } from '../../resources/gameFinder';
import { isFeatureEnabled } from '../../utils/features';
import { finderQuery, parseFinder, type FinderFilter } from '../../utils/gameFinder';
import { LEAGUES, type BasketballLeague } from '../../utils/league';
import { playerCache, setCache, uncacheable } from './cache';

/**
 * The first season the selects offer: the ESPN box releases' start for the pro leagues (the game pages' 2002 backfill floor).
 * ponytail: one floor for all four leagues; a season the boxes don't hold answers "no games", never an error.
 */
export const FINDER_FIRST_SEASON = 2002;

export interface GameFinderParams {
    league: BasketballLeague;
    seasons: number[];
    current: number;
    filter: FinderFilter;
    /** null: no threshold yet, so no read */
    body: FinderBody | null;
}

export type GameFinderPrep = { notFound: true } | { unavailable: true } | GameFinderParams;

export async function prepareGameFinder(Astro: AstroGlobal, league: BasketballLeague): Promise<GameFinderPrep> {
    Astro.locals.league = league;
    if (!isFeatureEnabled('bball-game-finder', Astro.locals)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const seasons = LEAGUES[league].seasons.filter((s) => s >= FINDER_FIRST_SEASON);
    const current = seasons[seasons.length - 1];
    const filter = parseFinder(Astro.url.searchParams, seasons, current);
    if (Object.keys(filter.stats).length === 0) {
        setCache(Astro, playerCache(league));
        return { league, seasons, current, filter, body: null };
    }
    let body: FinderBody;
    try {
        body = await retrieveGameFinder(league, finderQuery(filter));
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} game finder: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    setCache(Astro, playerCache(league));
    return { league, seasons, current, filter, body };
}
