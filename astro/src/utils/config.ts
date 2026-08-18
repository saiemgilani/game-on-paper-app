import { env } from "cloudflare:workers"
import type { CacheOptions } from "astro";
import { DateTime } from "luxon";
import type { ESPNStatus } from "../resources/espn";

export interface SeasonConfig {
    liveGameRefreshRate: number
    scoreboardRefreshRate: number
}

function retrieveSeasonConfig(): SeasonConfig {
    if (env.SEASON_MODE == "normal") {
        return {
            liveGameRefreshRate: 60 * 2,
            scoreboardRefreshRate: 60 * 2,
        }
    } else {
        return {
            liveGameRefreshRate: 60 * 60 * 24,
            scoreboardRefreshRate: 60 * 60 * 24,
        }
    }
}

export const CURRENT_SEASON_CONFIG = retrieveSeasonConfig();
export const CACHE_TTL_MULTIPLIER = 2;

export function getGameCacheConfig(date: string, status: ESPNStatus): CacheOptions {
    const gameDate = DateTime.fromISO(date);
    const todayPlusOneDay = DateTime.now().plus({ days: 1 })
    const isGameWithinOneDay = gameDate.diff(todayPlusOneDay).days < 1;

    if (status.type.completed) {
        // cache one year for completed games
        return {
            maxAge: 60 * 60 * 24 * 7 * 52,
            tags: ['game-completed', "favorites-enabled"],
        }
    } else if (status.type.name == "STATUS_SCHEDULED" && isGameWithinOneDay) {
        // cache one hour for scheduled games within 24 hours
        return {
            maxAge: 60 * 60,
            tags: ['game-scheduled-today'],
        }
    } else if (status.type.name == "STATUS_SCHEDULED") {
        // cache one day for scheduled games outside 24 hours
        return {
            maxAge: 60 * 60 * 24,
            tags: ['game-scheduled-future', "favorites-enabled"],
        }
    } else {
        // cache N minutes for live games
        return {
            maxAge: CURRENT_SEASON_CONFIG.liveGameRefreshRate,
            // use SWR here for performance 
            swr: CURRENT_SEASON_CONFIG.liveGameRefreshRate * CACHE_TTL_MULTIPLIER,
            tags: ['game-in-progress', "favorites-enabled"],
        }
    }
}
