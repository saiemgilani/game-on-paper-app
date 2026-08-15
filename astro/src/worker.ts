import { handle } from '@astrojs/cloudflare/handler';
import { getCurrentScoreboard } from './resources/espn';
import { CURRENT_SEASON_CONFIG } from './utils/config';



export default {
    async fetch(request, env, ctx) {
        return handle(request, env, ctx);
    },
    async scheduled(controller, env, ctx) {
        // cron fires every minute.
        const config = CURRENT_SEASON_CONFIG;
        const scoreboardTTLMillis = (config.scoreboardRefreshRate * 1000);
        const utcMillis = new Date().getTime();

        if (utcMillis % scoreboardTTLMillis == 0) {
            try {
                console.info(`Firing scheduled refresh of scoreboard...`)
                await getCurrentScoreboard(false, true);
            } catch (err) {
                console.error(`ERROR while refreshing scoreboard cache: ${err}`)
            }
        } else {
            console.info(`Skipping scheduled refresh of scoreboard, cadence: ${scoreboardTTLMillis}.`)
        }
    },
} satisfies ExportedHandler<Env>;