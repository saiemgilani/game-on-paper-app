import { handle } from '@astrojs/cloudflare/handler';
import { cache } from 'cloudflare:workers';
import { getCurrentScoreboard } from './resources/espn';
import { sdvLatestIngest } from './resources/sdv';
import { CURRENT_SEASON_CONFIG } from './utils/config';
import { PURGED_FOR_INGEST_KEY, SUMMARY_PAGE_TAGS, shouldPurge } from './utils/pagePurge';

// Clear the summary-backed pages once per Data API ingest (utils/pagePurge.ts).
async function purgePagesAfterIngest(env: Env) {
    try {
        const latest = await sdvLatestIngest();
        const purgedFor = await env.SDV_API_CACHE.get(PURGED_FOR_INGEST_KEY);
        if (!shouldPurge(latest, purgedFor, Date.now())) return;
        // a failed purge resolves (not rejects): leave the key so the next run retries
        const res = await cache.purge({ tags: SUMMARY_PAGE_TAGS });
        if (!res.success) throw new Error(JSON.stringify(res.errors));
        await env.SDV_API_CACHE.put(PURGED_FOR_INGEST_KEY, latest!);
        console.info(`Purged ${SUMMARY_PAGE_TAGS.join(',')} for the ${latest} ingest`);
    } catch (err) {
        console.error(`ERROR while purging pages after an ingest: ${err}`);
    }
}



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
        if (scheduledMinute % 15 == 0) ctx.waitUntil(purgePagesAfterIngest(env));
    },
} satisfies ExportedHandler<Env>;