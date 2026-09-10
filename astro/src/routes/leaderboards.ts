/**
 * Page-side step of the season leaderboards (`/year/[year]/teams[/category]`,
 * `/year/[year]/players[/category]`): the league, the category check and the
 * current-season redirect. Both leagues' pages call these and render the
 * shared leaderboard components.
 */
import type { AstroGlobal } from 'astro';
import { CURRENT_YEAR, LAST_YEAR } from '../utils/constants';
import { leaguePath, teamCategoriesFor, type League } from '../utils/league';
import { modifyMetricForCategory } from '../utils/misc';
import { PLAYER_LEADERBOARD_CATEGORIES } from '../utils/seo';

export interface LeaderboardParams {
    season: number;
    category?: string;
    metric?: string;
}

export type LeaderboardPrep = { redirect: string } | { notFound: true } | LeaderboardParams;

function seasonOf(Astro: AstroGlobal): number {
    return parseInt(Astro.params.year || `${CURRENT_YEAR}`);
}

// /year/[year]/teams and /year/[year]/players: the current season redirects to
// the last completed one (there is no in-progress season table yet).
export function prepareLeaderboard(Astro: AstroGlobal, league: League, kind: 'teams' | 'players'): LeaderboardPrep {
    Astro.locals.league = league;
    if (Astro.params.year == `${CURRENT_YEAR}`) {
        return { redirect: leaguePath(league, `/year/${LAST_YEAR}/${kind}`) };
    }
    return { season: seasonOf(Astro) };
}

// An unknown category (/teams/offense, /teams/bogus) rendered as HTTP 200 with a
// 0-byte body -- indexable as a thin page and a crawl-budget sink. Measured
// 2026-08-29. A route that has nothing is a 404. The team category list is per
// league: the nfl carries rbsdm-style extras the college grid does not have.
export function prepareTeamCategory(Astro: AstroGlobal, league: League): LeaderboardPrep {
    Astro.locals.league = league;
    const { year, category } = Astro.params;
    if (!category || !teamCategoriesFor(league).includes(category)) {
        return { notFound: true };
    }
    if (year == `${CURRENT_YEAR}`) {
        return { redirect: leaguePath(league, `/year/${LAST_YEAR}/teams/${category}`) };
    }
    const metric = Astro.url.searchParams.get("sort") || modifyMetricForCategory(category, "net_adj_epa");
    return { season: seasonOf(Astro), category, metric };
}

export function preparePlayerCategory(Astro: AstroGlobal, league: League): LeaderboardPrep {
    Astro.locals.league = league;
    const { year, category } = Astro.params;
    if (!category || !PLAYER_LEADERBOARD_CATEGORIES.includes(category)) {
        return { notFound: true };
    }
    if (year == `${CURRENT_YEAR}`) {
        return { redirect: leaguePath(league, `/year/${LAST_YEAR}/players/${category}`) };
    }
    const metric = Astro.url.searchParams.get("sort") || "TEPA";
    return { season: seasonOf(Astro), category, metric };
}
