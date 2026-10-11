// src/routes/nba/leaders.ts
/**
 * Page-side step of /nba/leaders: blazing-the-nets' readLeaders over the Data API. Two reads,
 * the season's player rows (names) and every player's game rows; blazing's leaderBoards
 * (copied) builds every window x metric board in the Worker. The page is a season page, so
 * Workers Caching holds the result for 6 h (+ 6 h stale): blazing memoised it per process for
 * the same window. No game rows (a season without logs) is boards: null, which the page explains.
 */
import type { AstroGlobal } from 'astro';
import { seasonPlayerGamesFromRows } from '../../nba/adapters';
import { leaderBoards, type Boards } from '../../nba/data/leaders';
import { NETS_TEAM_ID } from '../../nba/data/teams';
import { retrieveSeasonPlayerGameRows } from '../../resources/nbaShots';
import { SEASON_CACHE, setCache, uncacheable } from './cache';
import { resolveSeason } from './home';
import { readSeasonRows } from './season';

export interface NbaLeadersParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    /** null when the season has no placeable game logs: rolling windows need game dates. */
    boards: Boards | null;
}

export type NbaLeadersPrep = { unavailable: true } | NbaLeadersParams;

export async function prepareNbaLeaders(Astro: AstroGlobal): Promise<NbaLeadersPrep> {
    Astro.locals.league = 'nba';
    const resolved = resolveSeason(Astro);
    const { season } = resolved;
    // the season-players read settles the cache policy; it is set below once the game rows are in too
    const [players, games] = await Promise.all([
        readSeasonRows(Astro, season, '/nba/leaders', false),
        retrieveSeasonPlayerGameRows(season).catch((e: any) => {
            console.error(`ERROR while loading season game rows for /nba/leaders ${season}: ${e}, ${e?.stack}`);
            uncacheable(Astro);
            return null;
        }),
    ]);
    if (!players || !games) return { unavailable: true };
    const placed = seasonPlayerGamesFromRows(games, players);
    if (players.length > 0) setCache(Astro, SEASON_CACHE); // empty: readSeasonRows already made it uncacheable
    return { ...resolved, boards: placed.length ? leaderBoards(placed, NETS_TEAM_ID) : null };
}
