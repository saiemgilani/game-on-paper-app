/**
 * Page-side step of the season leaderboards (`/year/[year]/teams[/category]`,
 * `/year/[year]/players[/category]`, `/year/[year]/coaches[/board]`,
 * `/coaches[/board]`): the league, the category check and the current-season
 * redirect. Both leagues' pages call these and render the shared leaderboard
 * components.
 */
import type { AstroGlobal } from 'astro';
import { CURRENT_YEAR, LAST_YEAR } from '../utils/constants';
import { leaguePath, teamCategoriesFor, type League } from '../utils/league';
import { modifyMetricForCategory } from '../utils/misc';
import { PLAYER_LEADERBOARD_CATEGORIES } from '../utils/seo';
import { COACH_BOARD_SLUGS, DEFAULT_COACH_BOARD, resolveCoachSort } from '../utils/coaches';

export interface LeaderboardParams {
    season: number;
    category?: string;
    metric?: string;
}

export type LeaderboardPrep = { redirect: string } | { notFound: true } | LeaderboardParams;

// a four-digit year or nothing: `2025junk` / `abc` would otherwise reach the
// season tables as NaN and render an empty page as HTTP 200
function seasonOf(Astro: AstroGlobal): number | null {
    const y = Astro.params.year;
    if (y === undefined) return CURRENT_YEAR;
    return /^\d{4}$/.test(y) ? parseInt(y) : null;
}

// /year/[year]/teams and /year/[year]/players: the current season redirects to
// the last completed one (there is no in-progress season table yet).
export function prepareLeaderboard(Astro: AstroGlobal, league: League, kind: 'teams' | 'players'): LeaderboardPrep {
    Astro.locals.league = league;
    const season = seasonOf(Astro);
    if (season === null) return { notFound: true };
    if (season === CURRENT_YEAR) {
        return { redirect: leaguePath(league, `/year/${LAST_YEAR}/${kind}`) };
    }
    return { season };
}

// An unknown category (/teams/offense, /teams/bogus) rendered as HTTP 200 with a
// 0-byte body -- indexable as a thin page and a crawl-budget sink. Measured
// 2026-08-29. A route that has nothing is a 404. The team category list is per
// league: the nfl carries rbsdm-style extras the college grid does not have.
export function prepareTeamCategory(Astro: AstroGlobal, league: League): LeaderboardPrep {
    Astro.locals.league = league;
    const { category } = Astro.params;
    if (!category || !teamCategoriesFor(league).includes(category)) {
        return { notFound: true };
    }
    const season = seasonOf(Astro);
    if (season === null) return { notFound: true };
    if (season === CURRENT_YEAR) {
        return { redirect: leaguePath(league, `/year/${LAST_YEAR}/teams/${category}`) };
    }
    const metric = Astro.url.searchParams.get("sort") || modifyMetricForCategory(category, "net_adj_epa");
    return { season, category, metric };
}

export function preparePlayerCategory(Astro: AstroGlobal, league: League): LeaderboardPrep {
    Astro.locals.league = league;
    const { category } = Astro.params;
    if (!category || !PLAYER_LEADERBOARD_CATEGORIES.includes(category)) {
        return { notFound: true };
    }
    const season = seasonOf(Astro);
    if (season === null) return { notFound: true };
    if (season === CURRENT_YEAR) {
        return { redirect: leaguePath(league, `/year/${LAST_YEAR}/players/${category}`) };
    }
    const metric = Astro.url.searchParams.get("sort") || "TEPA";
    return { season, category, metric };
}

export interface CoachBoardParams {
    /** absent on the careers board, which pools every season */
    season?: number;
    board: string;
    metric: string;
}

export type CoachBoardPrep = { redirect: string } | { notFound: true } | CoachBoardParams;

// /year/[year]/coaches and /coaches are hubs with nothing of their own: they
// send the reader to the default board (the current season to the last
// completed one, as the team hub does).
export function prepareCoachIndex(Astro: AstroGlobal, league: League): { redirect: string } | { notFound: true } {
    Astro.locals.league = league;
    if (Astro.params.year === undefined) {
        return { redirect: leaguePath(league, `/coaches/${DEFAULT_COACH_BOARD}`) };
    }
    const season = seasonOf(Astro);
    if (season === null) return { notFound: true };
    const target = season === CURRENT_YEAR ? LAST_YEAR : season;
    return { redirect: leaguePath(league, `/year/${target}/coaches/${DEFAULT_COACH_BOARD}`) };
}

// /year/[year]/coaches/[board]: an unknown board or a malformed year is a 404,
// the current season redirects, `?sort=` must name a column the board has.
export function prepareCoachBoard(Astro: AstroGlobal, league: League): CoachBoardPrep {
    Astro.locals.league = league;
    const { board } = Astro.params;
    // an own-key check: `in` matches inherited names, so /coaches/toString
    // would pass the guard and crash on COACH_BOARDS.toString.columns
    if (!board || !COACH_BOARD_SLUGS.includes(board)) {
        return { notFound: true };
    }
    const season = seasonOf(Astro);
    if (season === null) return { notFound: true };
    if (season === CURRENT_YEAR) {
        return { redirect: leaguePath(league, `/year/${LAST_YEAR}/coaches/${board}`) };
    }
    const metric = resolveCoachSort(board, Astro.url.searchParams.get('sort'));
    return { season, board, metric };
}

// /coaches/[board]: careers pool every season, so there is no year to check.
export function prepareCoachCareers(Astro: AstroGlobal, league: League): CoachBoardPrep {
    Astro.locals.league = league;
    const { board } = Astro.params;
    // an own-key check: `in` matches inherited names, so /coaches/toString
    // would pass the guard and crash on COACH_BOARDS.toString.columns
    if (!board || !COACH_BOARD_SLUGS.includes(board)) {
        return { notFound: true };
    }
    const metric = resolveCoachSort(board, Astro.url.searchParams.get('sort'));
    return { board, metric };
}
