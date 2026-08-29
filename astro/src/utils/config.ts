import { env } from "cloudflare:workers"
import type { CacheOptions } from "astro";
import { DateTime, Interval } from "luxon";
import type { ESPNScheduleEntry, ESPNStatus } from "../resources/espn";
import { CURRENT_YEAR } from "./constants";
import { GLOBAL_SCHEDULE_MAP } from "../resources/schedule";

export interface SeasonConfig {
    liveGameRefreshRate: number
    scoreboardRefreshRate: number
}

function retrieveSeasonConfig(): SeasonConfig {
    if (env.SEASON_MODE == "normal") {
        return {
            liveGameRefreshRate: 60,
            scoreboardRefreshRate: 60,
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

export function getScheduleCacheConfig(date: Date, season: string | number, seasontype: string | number, week: string | number, hasActiveGames: boolean): CacheOptions {
    const espnWeek = GLOBAL_SCHEDULE_MAP[`${season}`].find(s => s.type == `${seasontype}` && s.value == `${week}`)
    // if we can't validate the week against the schedule, check if it has active games. 
    // If it does, reload actively. If not, never reload.
    if (!espnWeek) {
        if (hasActiveGames) {
            return {
                maxAge: 60 * 60 * 24 * 365,
                tags: ['week-complete'],
            }
        } else {
            // cache N minutes for live games
            return {
                maxAge: CURRENT_SEASON_CONFIG.scoreboardRefreshRate,
                // use SWR here for performance 
                swr: CURRENT_SEASON_CONFIG.scoreboardRefreshRate * CACHE_TTL_MULTIPLIER,
                tags: ['week-in-progress'],
            }
        }
    }

    const gameDate = DateTime.fromJSDate(date);
    const startDate = DateTime.fromISO(espnWeek.startDate);
    const endDate = DateTime.fromISO(espnWeek.endDate);
    const gameWeek = Interval.fromDateTimes(startDate, endDate);

    if (gameWeek.contains(gameDate) && hasActiveGames)  {
        // cache N minutes for live games
        return {
            maxAge: CURRENT_SEASON_CONFIG.scoreboardRefreshRate,
            // use SWR here for performance 
            swr: CURRENT_SEASON_CONFIG.scoreboardRefreshRate * CACHE_TTL_MULTIPLIER,
            tags: ['week-in-progress'],
        }
    } else if (gameWeek.contains(gameDate)) {
        // cache if we're in a game week with no active games, reload every hour
        return {
            maxAge: 60 * 60,
            tags: ['week-scheduled-current-week'],
        }
    } else if (!gameWeek.contains(gameDate) && season == CURRENT_YEAR) {
        // if we're not in a game week but in the current season, then reload every day
        return {
            maxAge: 60 * 60 * 24,
            tags: ['week-scheduled-current-season'],
        }
    } else {
        // if we're not in a game week or in the current season, then never reload
        return {
            maxAge: 60 * 60 * 24 * 365,
            tags: ['week-complete'],
        }
    }
}

