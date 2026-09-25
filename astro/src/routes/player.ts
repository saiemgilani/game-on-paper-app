/**
 * Page-side step of the individual player pages (`/players/[id]`, `/nfl/players/[id]`):
 * the league, the id shape, the season query param, and the one redirect the
 * NFL needs.
 *
 * Mirrors `routes/leaderboards.ts` -- the prep is pure-ish and testable, the
 * page file stays three lines, and a malformed id becomes a 404 instead of
 * reaching the Data API as garbage. It also owns the page's Workers Caching
 * policy, as `game.ts` / `matchup.ts` / `charts.ts` own theirs.
 */
import type { AstroGlobal } from 'astro';
import { leaguePath, type League } from '../utils/league';
import { isEspnAthleteId, isGsisId } from '../utils/players';
import { resolveEspnAthleteId, retrievePlayer, type SDVPlayer } from '../resources/sdv';

export interface PlayerParams {
    player: SDVPlayer;
    /**
     * The season to show, always one the player actually has rows for, or
     * `null` when `?season=` is absent -- which is the CAREER view, the page's
     * default (review on #267).
     */
    season: number | null;
}

/**
 * `unavailable` is NOT `notFound`: a crosswalk or identity read that FAILED is
 * an outage, and answering it with a 404 would tell a crawler the player does
 * not exist and hide the outage from anything watching status codes. It becomes
 * a 503 with `no-store`.
 */
export type PlayerPrep =
    { redirect: string } | { notFound: true } | { unavailable: true } | PlayerParams;

/**
 * A rendered player page is cacheable per (league, id, season) -- all three are
 * in the URL, which is the Workers Caching key: the league and the id in the
 * path, the season in `?season=`. Tagged so `/admin/api/purge-game?tags=player`
 * can clear every one after a producer republish.
 */
const PLAYER_CACHE = { maxAge: 60 * 60, swr: 60 * 60 * 6, tags: ['player'] };

/**
 * Hand the policy to Workers Caching. Optional-chained and wrapped the way
 * `middleware.ts` does it: the cache provider is a Cloudflare runtime thing and
 * is absent in dev and under the Container API.
 */
function setCache(Astro: AstroGlobal, config: typeof PLAYER_CACHE | false): void {
    try { (Astro as any).cache?.set(config); } catch { /* cache provider absent in dev */ }
}

/**
 * Never cache this response. `Astro.cache.set(false)` emits NO header, and
 * Workers Caching holds a header-less 200 for a heuristic ~2 hours -- so a 404
 * from one bad upstream minute would freeze a real player's page as a 404 with
 * no way to purge it. Opting out has to be explicit, exactly as `game.ts` says.
 */
function uncacheable(Astro: AstroGlobal): void {
    setCache(Astro, false);
    try { Astro.response?.headers?.set('Cache-Control', 'no-store'); } catch { /* as above */ }
}

/**
 * The answer to an identity/crosswalk read that failed: a 503 that monitoring
 * can see, never a 404 that says the player does not exist.
 */
export const PLAYER_UNAVAILABLE = (): Response => new Response(
    'Player data is temporarily unavailable. Please try again shortly.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' } },
);

export async function preparePlayer(Astro: AstroGlobal, league: League): Promise<PlayerPrep> {
    Astro.locals.league = league;
    const id = Astro.params.id;
    if (!id) {
        uncacheable(Astro);
        return { notFound: true };
    }

    const seasonParam = Astro.url.searchParams.get('season');
    const valid = seasonParam !== null && /^\d{4}$/.test(seasonParam);
    const season = valid ? parseInt(seasonParam as string) : null;
    // carry the VALIDATED TEXT through the redirect, not the parsed number:
    // `?season=0000` parses to 0, which is falsy and would drop the param, and
    // `?season=0202` would be rewritten to `202`. Either way the canonical URL
    // would render the latest season instead of the 404 those ask for.
    const query = valid ? `?season=${seasonParam}` : '';

    // The NFL season leaderboards key on gsis, so their rows can only link here
    // with a gsis id. Resolve it through the nflverse crosswalk ONCE and send the
    // reader to the canonical ESPN-id URL -- the id every other surface uses, and
    // the only one the Data API's player routes accept.
    if (league === 'nfl' && isGsisId(id)) {
        // A gsis id nobody has is a 404; a crosswalk read that FAILED is an
        // outage and says so. Either way the answer is not cached -- a 302 or a
        // 404 frozen on a transient miss would outlive the miss.
        let espnId: string | null;
        try {
            espnId = await resolveEspnAthleteId(id);
        } catch (e: any) {
            console.error(`ERROR while resolving gsis ${id}: ${e}, ${e?.stack}`);
            uncacheable(Astro);
            return { unavailable: true };
        }
        uncacheable(Astro);
        if (!espnId) return { notFound: true };
        return { redirect: leaguePath(league, `/players/${espnId}`) + query };
    }

    if (!isEspnAthleteId(id)) {
        uncacheable(Astro);
        return { notFound: true };
    }

    // The one fetch the ROUTE makes, and the only one on the page that cannot
    // degrade: the Data API 404s an id with no rows anywhere, and that 404 has
    // to become the site's 404 -- an identity shell for a player who does not
    // exist would be indexed as a thin page. A read that THROWS is a different
    // thing and answers differently (503, see `PlayerPrep`); either way it is
    // uncacheable, so neither can freeze a real player's page.
    let player: SDVPlayer | null = null;
    try {
        player = await retrievePlayer(id, league);
    } catch (e: any) {
        console.error(`ERROR while loading player ${id}: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    if (!player) {
        uncacheable(Astro);
        return { notFound: true };
    }
    // a hand-typed season the player has no rows for is a 404 too; the dropdown
    // only ever offers seasons from `player.seasons`
    if (season !== null && !player.seasons.includes(season)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    setCache(Astro, PLAYER_CACHE);
    // no `?season=` is not "the latest season": it is the career view
    return { player, season };
}
