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
import { retrieveSeasonPlayerGameRows, retrieveSeasonPlayerRows } from '../../resources/nbaShots';
import { SEASON_CACHE, setCache, uncacheable } from './cache';
import { resolveSeason } from './home';

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
    const reads = await Promise.allSettled([retrieveSeasonPlayerRows(season), retrieveSeasonPlayerGameRows(season)]);
    const [playersR, gamesR] = reads;
    for (const [name, r] of [['season players', playersR], ['season game rows', gamesR]] as const) {
        if (r.status === 'rejected') {
            console.error(`ERROR while loading ${name} for /nba/leaders ${season}: ${r.reason}`);
            uncacheable(Astro);
            return { unavailable: true };
        }
    }
    if (playersR.status !== 'fulfilled' || gamesR.status !== 'fulfilled') return { unavailable: true };
    const players = seasonPlayerGamesFromRows(gamesR.value, playersR.value);
    if (playersR.value.length === 0) uncacheable(Astro); // not ingested yet
    else setCache(Astro, SEASON_CACHE);
    return { ...resolved, boards: players.length ? leaderBoards(players, NETS_TEAM_ID) : null };
}
