import { handle } from '@astrojs/cloudflare/handler';
import { getCurrentScoreboard } from './resources/espn';
import { CURRENT_SEASON_CONFIG } from './utils/config';
import { runProDigest, sweepLoginMarkers } from './resources/pro';



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

        // Game on Paper Pro's portal digest, 12:00 UTC (7 a.m. Eastern in the Dec/Jan
        // windows), mailing yesterday's matching entrants. Off unless PRO_DIGEST_ENABLED
        // is "1". ponytail: switched on by hand for each portal window.
        const at = new Date(controller.scheduledTime);
        // Spent Pro magic-link markers in R2, once a day at 04:00 UTC.
        if (at.getUTCHours() === 4 && at.getUTCMinutes() === 0) {
            ctx.waitUntil(sweepLoginMarkers()
                .then((n) => console.info(`Pro sign-in markers swept: ${n}`))
                .catch((err) => console.error(`ERROR sweeping Pro sign-in markers: ${err}`)));
        }
        if ((env as any).PRO_DIGEST_ENABLED === '1' && at.getUTCHours() === 12 && at.getUTCMinutes() === 0) {
            const today = at.toISOString().slice(0, 10);
            const yesterday = new Date(controller.scheduledTime - 86_400_000).toISOString().slice(0, 10);
            ctx.waitUntil(runProDigest(yesterday, today)
                .then((n) => console.info(`Pro portal digest: ${n} emails`))
                .catch((err) => console.error(`ERROR in Pro portal digest: ${err}`)));
        }
    },
} satisfies ExportedHandler<Env>;