/**
 * Clearing the summary-backed pages after a Data API ingest (worker.ts's cron).
 * Those pages cache for 3 days at the edge (astro.config.mjs route rules), and a
 * cache HIT never runs the Worker, so the /v1/meta stamp that versions their API
 * reads cannot move them: before this a summaries republish waited out the TTL or
 * a redeploy. Pure (no cloudflare:* imports) so vitest runs it.
 */

/** Every tag a page rendered from season/team/player summaries carries
 *  ('chart' is the chart builder's own, routes/charts.ts). */
export const SUMMARY_PAGE_TAGS = ['season', 'team', 'teams-index', 'charts', 'chart', 'leaderboards', 'player'];

/** KV key holding the ingest stamps (JSON, table -> stamp) the pages were last purged for. */
export const PURGED_FOR_INGEST_KEY = 'pages-purged-for-ingests';

/** Wait this long past an ingest: the meta copies in isolates and KV take up to ~10 min
 *  (sdv.ts SDV_META_TTL, both windows) to see it, and a page re-rendered before then
 *  would cache the pre-ingest rows for another 3 days. */
export const PURGE_SETTLE_MS = 15 * 60 * 1000;

export type IngestStamps = Record<string, string>;

/**
 * What a purge run now would cover, or undefined when there is nothing to purge.
 * Compared per table, not as one newest stamp: a re-ingested table whose stamp is
 * older than another table's still counts, and stamps compare as the API's strings
 * (no millisecond rounding). A stamp still settling keeps the value the last purge
 * covered, so it neither triggers a purge early nor blocks a settled one; it purges
 * again on a later run once it settles.
 */
export function purgeTarget(datasets: IngestStamps | null | undefined, schemas: string[],
                            purgedFor: IngestStamps, now: number): IngestStamps | undefined {
    const next = { ...purgedFor };
    let changed = false;
    for (const [key, iso] of Object.entries(datasets ?? {})) {
        if (!schemas.includes(key.split('.')[0]) || !(now - Date.parse(iso) >= PURGE_SETTLE_MS)) continue;
        if (purgedFor[key] !== iso) { next[key] = iso; changed = true; }
    }
    return changed ? next : undefined;
}
