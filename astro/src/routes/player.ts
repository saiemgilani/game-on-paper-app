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
import { isEspnAthleteId, isGsisId, type PlayerGameRow, type SeasonRow } from '../utils/players';
import {
    resolveEspnAthleteId, retrievePlayer, retrievePlayerSeasons, retrievePlayerGames, retrievePlayerSplits,
    retrieveNflEspnGameIds, retrievePlayerGamePercentiles, retrieveTeamSummaries,
    type SDVPlayer, type SDVPlayerSplit, type SDVTeamSummary,
} from '../resources/sdv';

/** Every section's data, each the empty shape when its read failed. */
export interface PlayerSections {
    seasonRows: SeasonRow[];
    games: PlayerGameRow[];
    splits: SDVPlayerSplit[];
    /** nflverse game id -> ESPN event id (NFL only) */
    espnGameIds: Record<string, string>;
    /** the league-season distribution the game log's second shading reads */
    leagueBreaks: Record<string, number[]>;
    /** the season's team_summaries rows, for the Team Context panel */
    teamRows: SDVTeamSummary[];
    /** which panels have to say "unavailable" instead of "nothing to show" */
    failed: { seasons: boolean; games: boolean; splits: boolean };
}

export interface PlayerParams {
    player: SDVPlayer;
    /**
     * The season to show, always one the player actually has rows for, or
     * `null` when `?season=` is absent -- which is the CAREER view, the page's
     * default (review on #267).
     */
    season: number | null;
    sections: PlayerSections;
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
    // no `?season=` is not "the latest season": it is the career view
    const { sections, degraded } = await loadPlayerSections(player, season, league);
    // A page rendered around a failed read is served, but never cached: frozen
    // for the TTL it would keep saying "unavailable" long after the upstream
    // recovered (CodeRabbit on #267). The reads are made HERE, not in the page
    // component, because the page streams -- by the time a component's reads
    // settle, the response headers are already gone.
    if (degraded) uncacheable(Astro);
    else setCache(Astro, PLAYER_CACHE);
    return { player, season, sections };
}

const TEAM_CONTEXT_METRICS = ['EPAplay_off', 'success_off', 'explosive_off', 'EPAplay_def'];

/**
 * Every section's read, settled independently: `Promise.all` would let one
 * upstream hiccup reject the lot and blank a page whose other sections were
 * fine. The career view needs only the season rows; the season-only reads are
 * not made at all rather than made and thrown away.
 */
export async function loadPlayerSections(player: SDVPlayer, season: number | null, league: League):
    Promise<{ sections: PlayerSections, degraded: boolean }> {
    const reads = await Promise.allSettled([
        retrievePlayerSeasons(player.espn_id, league),
        season === null ? Promise.resolve([]) : retrievePlayerGames(player.espn_id, season, league),
        season === null ? Promise.resolve([]) : retrievePlayerSplits(player.espn_id, season, league),
        season !== null && league === 'nfl' ? retrieveNflEspnGameIds(season) : Promise.resolve({}),
        // a not-yet-deployed percentiles route is a 404 -> {}, not a failure
        season === null ? Promise.resolve({}) : retrievePlayerGamePercentiles(season, league),
        // one cached call for the whole season, filtered to his team(s) by the page
        season === null ? Promise.resolve([]) : retrieveTeamSummaries({ season, league, columns: TEAM_CONTEXT_METRICS }),
    ]);
    const value = (i: number, empty: any): any => {
        const r = reads[i];
        if (r.status === 'fulfilled') return r.value;
        console.error(`player page: a section read failed: ${r.reason}`);
        return empty;
    };
    return {
        sections: {
            seasonRows: value(0, []), games: value(1, []), splits: value(2, []),
            espnGameIds: value(3, {}), leagueBreaks: value(4, {}), teamRows: value(5, []),
            failed: { seasons: reads[0].status === 'rejected', games: reads[1].status === 'rejected', splits: reads[2].status === 'rejected' },
        },
        degraded: reads.some((r) => r.status === 'rejected'),
    };
}
