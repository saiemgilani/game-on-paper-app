// src/routes/basketball/leaders.ts
/**
 * Page-side step of /<league>/leaders: blazing-the-nets' readLeaders over the Data API. Two reads,
 * the season's player rows (names) and every player's game rows; blazing's leaderBoards
 * (copied) builds every window x metric board in the Worker. The page is a season page, so
 * Workers Caching holds the result for 6 h (+ 6 h stale): blazing memoised it per process for
 * the same window. No game rows (a season without logs) is boards: null, which the page explains.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { seasonPlayerGamesFromRows } from '../../nba/adapters';
import { leaderBoards, type Boards } from '../../nba/data/leaders';
import { retrieveSeasonPlayerGameRows } from '../../resources/nbaShots';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { seasonCache, setCache, uncacheable } from './cache';
import { readBasketballSeasonRows, resolveBasketballSeason } from './season';

export interface BasketballLeadersParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    /** null when the season has no placeable game logs: rolling windows need game dates. */
    boards: Boards | null;
}

export type BasketballLeadersPrep = { unavailable: true } | BasketballLeadersParams;

export async function prepareBasketballLeaders(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballLeadersPrep> {
    Astro.locals.league = league;
    const ft = BASKETBALL[league].featuredTeam;
    const route = leaguePath(league, '/leaders');
    const resolved = resolveBasketballSeason(Astro, league);
    const { season } = resolved;
    // the season-players read settles the cache policy; it is set below once the game rows are in too
    const [players, games] = await Promise.all([
        readBasketballSeasonRows(Astro, league, season, route, false),
        retrieveSeasonPlayerGameRows(season, league).catch((e: any) => {
            console.error(`ERROR while loading season game rows for ${route} ${season}: ${e}, ${e?.stack}`);
            uncacheable(Astro);
            return null;
        }),
    ]);
    if (!players || !games) return { unavailable: true };
    const placed = seasonPlayerGamesFromRows(games, players);
    if (players.length > 0) setCache(Astro, seasonCache(league)); // empty: readBasketballSeasonRows already made it uncacheable
    // ponytail: 0 is no team, so no highlight; plan #6 makes the island's highlight optional
    return { ...resolved, boards: placed.length ? leaderBoards(placed, ft?.statsTeamId ?? 0) : null };
}
