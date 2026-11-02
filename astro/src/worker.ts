import { handle } from '@astrojs/cloudflare/handler';
import { cache } from 'cloudflare:workers';
import { getCurrentScoreboard } from './resources/espn';
import { sdvPurgeTarget } from './resources/sdv';
import { CURRENT_SEASON_CONFIG } from './utils/config';
import { type IngestStamps, PURGED_FOR_INGEST_KEY, SUMMARY_PAGE_TAGS } from './utils/pagePurge';

// Clear the summary-backed pages once per Data API ingest (utils/pagePurge.ts).
async function purgePagesAfterIngest(env: Env) {
    try {
        const purgedFor = await env.SDV_API_CACHE.get<IngestStamps>(PURGED_FOR_INGEST_KEY, 'json') ?? {};
        const target = await sdvPurgeTarget(purgedFor, Date.now());
        if (!target) return;
        // a failed purge resolves (not rejects): leave the key so the next run retries
        const res = await cache.purge({ tags: SUMMARY_PAGE_TAGS });
        if (!res.success) throw new Error(JSON.stringify(res.errors));
        await env.SDV_API_CACHE.put(PURGED_FOR_INGEST_KEY, JSON.stringify(target));
        console.info(`Purged ${SUMMARY_PAGE_TAGS.join(',')} for new ingests in ${Object.keys(target).length} tables`);
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
        // registered before the scoreboard await, so a stalled ESPN fetch can't skip it
        if (scheduledMinute % 15 == 0) ctx.waitUntil(purgePagesAfterIngest(env));

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