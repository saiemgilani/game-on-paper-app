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
        const scoreboardTTLMillis = (config.scoreboardTTL * 1000);
        const utcMillis = new Date().getTime();

        if (utcMillis % scoreboardTTLMillis == 0) {
            try {
                console.info(`${utcMillis} Firing scheduled refresh of scoreboard...`)
                await getCurrentScoreboard(false, true);
            } catch (err) {
                console.error(`ERROR while refreshing scoreboard cache: ${err}`)
            }
        }
    },
} satisfies ExportedHandler<Env>;