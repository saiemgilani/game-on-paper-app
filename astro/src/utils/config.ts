import { env } from "cloudflare:workers"

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