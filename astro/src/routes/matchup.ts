/**
 * Page-side step of the matchup builder: the 404 decision for a league without
 * season tables, the query parameters, and the cache policy. The data reads and
 * the template live in `components/routes/MatchupRoute.astro`.
 */
import type { AstroGlobal } from 'astro';
import { LEAGUES, type League } from '../utils/league';

export interface MatchupParams {
    league: League;
    awaySeason: string;
    awayTeamId: string;
    homeSeason: string;
    homeTeamId: string;
}

export type MatchupPrep = { notFound: true } | MatchupParams;

export function prepareMatchup(Astro: AstroGlobal, league: League): MatchupPrep {
    Astro.locals.league = league;
    // the builder is nothing but season-table reads; without them it is an empty
    // page with a college team selector, so it is a 404 for that league
    if (!LEAGUES[league].sdvEnabled) {
        Astro.cache.set(false);
        return { notFound: true };
    }
    const query = Astro.url.searchParams;
    const awaySeason = query.get("awaySeason") || "2025";
    const awayTeamId = query.get("awayTeamId") || (league === 'nfl' ? "12" : "52");
    const homeSeason = query.get("homeSeason") || "2025";
    const homeTeamId = query.get("homeTeamId") || (league === 'nfl' ? "2" : "59");
    const canDisplayMatchupView = !!(awaySeason && homeSeason && awayTeamId && homeTeamId);
    if (canDisplayMatchupView) {
        Astro.cache.set({
            maxAge: 60 * 60 * 24, // one day
            tags: ['matchup', "favorites-enabled"],
        })
    } else {
        Astro.cache.set(false);
        Astro.response.headers.set("Cache-Control", "no-store"); // see game route: set(false) alone is cached ~2h
    }
    return { league, awaySeason, awayTeamId, homeSeason, homeTeamId };
}
