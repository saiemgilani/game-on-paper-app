import { env } from "cloudflare:workers"

export interface SeasonConfig {
    liveGameTTL: number
    scoreboardTTL: number
}


function retrieveSeasonConfig(): SeasonConfig {
    if (env.SEASON_MODE == "normal") {
        return {
            liveGameTTL: 60,
            scoreboardTTL: 60,
        }
    } else {
        return {
            liveGameTTL: 60 * 60 * 24,
            scoreboardTTL: 60 * 60 * 24,
        }
    }
}

export const CURRENT_SEASON_CONFIG = retrieveSeasonConfig();