/**
 * Clearing the summary-backed pages after a Data API ingest (worker.ts's cron).
 * Those pages cache for 3 days at the edge (astro.config.mjs route rules), and a
 * cache HIT never runs the Worker, so the /v1/meta stamp that versions their API
 * reads cannot move them: before this a summaries republish waited out the TTL or
 * a redeploy. Pure (no cloudflare:* imports) so vitest runs it.
 */

/** Every tag a page rendered from season/team/player summaries carries. */
export const SUMMARY_PAGE_TAGS = ['season', 'team', 'teams-index', 'charts', 'leaderboards', 'player'];

/** KV key holding the ingest stamp the pages were last purged for. */
export const PURGED_FOR_INGEST_KEY = 'pages-purged-for-ingest';

/** Wait this long past an ingest: the meta copies in isolates and KV take up to ~10 min
 *  (sdv.ts SDV_META_TTL, both windows) to see it, and a page re-rendered before then
 *  would cache the pre-ingest rows for another 3 days. */
export const PURGE_SETTLE_MS = 15 * 60 * 1000;

/** The newest ingest time among `schemas`' tables in a /v1/meta `datasets` map. */
export function latestIngest(datasets: Record<string, string> | null | undefined, schemas: string[]): string | undefined {
    let best: string | undefined;
    for (const [key, iso] of Object.entries(datasets ?? {})) {
        if (!schemas.includes(key.split('.')[0]) || !Number.isFinite(Date.parse(iso))) continue;
        if (!best || Date.parse(iso) > Date.parse(best)) best = iso;
    }
    return best;
}

/** Purge when there is a newer ingest than the last purge and it has settled. */
export function shouldPurge(latest: string | undefined, purgedFor: string | null, now: number): boolean {
    return !!latest && latest !== purgedFor && now - Date.parse(latest) >= PURGE_SETTLE_MS;
}
