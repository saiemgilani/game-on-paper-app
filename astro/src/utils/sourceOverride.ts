/**
 * A per-game source override: an admin pins a game to a backup feed and every
 * path that processes it (the game page, its share card, the player-log QA
 * badge) asks the API for that source until the pin is removed.
 *
 * Kept in Workers KV (ESPN_API_CACHE, `source-override:<league>:<id>`, beside
 * the game's `gamestate:` and `card:` keys) with no expiry, so it lasts until
 * an admin deletes it from /admin or the game page's admin tools
 * (pages/admin/api/source-override.ts). The value is also the key's metadata,
 * so /admin lists every pin in one `list()` without a read per key.
 *
 * Honoured only where 'source-switch' (utils/features.ts) is on for the
 * request: while that flag is 'preview' an anonymous visitor's request, cache
 * key and render are exactly what they are today, pinned or not.
 *
 * KV is eventually consistent: a pin set in one colo can take up to a minute
 * to be read in another.
 */
import { env } from 'cloudflare:workers';
import type { League } from './league';

export interface SourceOverride {
    source: string
    /** the vetted admin identity (locals.adminActor) that set it */
    actor: string
    /** ISO time it was set */
    set_at: string
}

/** The leagues the processor's source switch serves (python/app.py mounts /sources for these). */
export const OVERRIDE_LEAGUES: readonly League[] = ['cfb', 'nfl'];
export const OVERRIDE_PREFIX = 'source-override:';
export const overrideKey = (league: League, id: string | number) => `${OVERRIDE_PREFIX}${league}:${id}`;

/** The game's pin, or null. A KV failure is no pin (fail-open: the page renders from ESPN). */
export async function readSourceOverride(league: League, id: string | number): Promise<SourceOverride | null> {
    try {
        return await env.ESPN_API_CACHE.get(overrideKey(league, id), 'json') as SourceOverride | null;
    } catch (e) {
        console.warn(`source override: KV read failed for ${league} ${id}: ${e}`);
        return null;
    }
}

/**
 * The source to send the API: an admin's explicit `?source=` wins, then the
 * pin. `espn` and nothing both mean the default path -- no `?source=` at all,
 * so the request and its cache key are the public one.
 */
export function effectiveSource(explicit: string | null | undefined, override: SourceOverride | null): string | undefined {
    const source = explicit || override?.source;
    return source && source !== 'espn' ? source : undefined;
}

/** `effectiveSource` with the pin read from KV, or undefined without a KV read when the flag is off. */
export async function gameSource(league: League, id: string | number, enabled: boolean, explicit?: string | null): Promise<string | undefined> {
    if (!enabled) return undefined;
    return effectiveSource(explicit, explicit ? null : await readSourceOverride(league, id));
}
