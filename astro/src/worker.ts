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
        // Bucket the *scheduled* time (always minute-aligned, no delivery jitter)
        // into whole minutes and fire every N minutes.
        const refreshMinutes = Math.max(1, Math.round(config.scoreboardRefreshRate / 60));
        const scheduledMinute = Math.floor(controller.scheduledTime / 60_000);

        if (scheduledMinute % refreshMinutes == 0) {
            try {
                console.info(`Firing scheduled refresh of scoreboard...`)
                await getCurrentScoreboard(false, true);
            } catch (err) {
                console.error(`ERROR while refreshing scoreboard cache: ${err}`)
            }
        } else {
            console.info(`Skipping scheduled refresh of scoreboard, cadence: every ${refreshMinutes} min.`)
        }
    },
} satisfies ExportedHandler<Env>;