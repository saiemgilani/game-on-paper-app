// src/routes/basketball/coaches.ts
/**
 * Page-side step of /<nba|wnba>/coaches (BB-G9, behind 'bball-coaches' inside the league's flag): the board, the
 * season (none = careers, as football's /coaches) and the sort from the query, then one Data API read. The template is
 * components/routes/BasketballCoachesRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { retrieveRows } from '../../resources/sdv';
import type { CoachRow } from '../../utils/coaches';
import { BBALL_COACH_FIRST_SEASON, bballCoachBoard, bballCoachSelect, bballCoachSort, type BballCoachLeague } from '../../utils/bballCoaches';
import { LEAGUES } from '../../utils/league';
import { seasonCache, setCache, uncacheable } from './cache';

/** The tables move once a night (the season-products timer): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A season is at most ~40 coach rows; the careers table a few hundred. The cap keeps a bad filter from paging silently. */
const SEASON_LIMIT = '100';
const CAREERS_LIMIT = '1000';

export interface BasketballCoachesParams {
    league: BballCoachLeague;
    /** newest first */
    seasons: number[];
    /** null: the careers board */
    season: number | null;
    board: string;
    sort: string;
    rows: CoachRow[];
}

export type BasketballCoachesPrep = { unavailable: true } | BasketballCoachesParams;

export async function prepareBasketballCoaches(Astro: AstroGlobal, league: BballCoachLeague): Promise<BasketballCoachesPrep> {
    Astro.locals.league = league;
    const sp = Astro.url.searchParams;
    const seasons = LEAGUES[league].seasons.filter((s) => s >= BBALL_COACH_FIRST_SEASON).toSorted((a, b) => b - a);
    const asked = Number(sp.get('season'));
    const season = seasons.includes(asked) ? asked : null;
    const board = bballCoachBoard(sp.get('board'));
    const sort = bballCoachSort(board, sp.get('sort')).key;
    const select = bballCoachSelect(season === null);
    let rows: CoachRow[];
    try {
        rows = season === null
            ? await retrieveRows<CoachRow>(league, 'coach_careers', { select, limit: CAREERS_LIMIT }, TTL, true)
            : await retrieveRows<CoachRow>(league, 'coach_seasons', { season: String(season), select, limit: SEASON_LIMIT }, TTL, true);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} coach ${season ?? 'careers'} board: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    // an empty season is not ingested yet: never hold the empty page for the season window
    if (rows.length > 0) setCache(Astro, seasonCache(league));
    else uncacheable(Astro);
    return { league, seasons, season, board: board.slug, sort, rows };
}
