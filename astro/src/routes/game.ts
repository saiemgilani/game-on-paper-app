/**
 * The game page's data step, shared by the explicit per-league pages
 * (`pages/game/[id].astro`, `pages/nfl/game/[id].astro`).
 *
 * Why a function and not a component: a page may `return Astro.redirect(...)`
 * from its frontmatter; a component may not (a rewrite/redirect inside a
 * component aborts the stream into an empty 200 -- see the manifest gate
 * history in the page). So the redirect DECISION is returned to the page, and
 * everything else -- fetch, cache policy, telemetry -- happens here once.
 */
import type { AstroGlobal } from 'astro';
import { GAME_PAGE_MANIFEST, evaluateManifest } from '../utils/manifest';
import { ESPN_INVALID_GAME_STATUS_NAMES, retrieveGamePageGuarded, type ESPNPlayByPlayResponse } from '../resources/espn';
import { gopStorage } from '../utils/telemetry';
import { retrieveProcessedGame, type ProcessedGame } from '../resources/python';
import { getGameCacheConfig } from '../utils/config';
import { isFeatureEnabled } from '../utils/features';
import { LEAGUES, leaguePath, type League } from '../utils/league';

export interface GameRouteData {
    league: League;
    id: string;
    espnGame: ESPNPlayByPlayResponse | null;
    game: ProcessedGame | null;
    /** scheduled/delayed with no processed plays: render the pregame page */
    pregameState: boolean;
    /** processed game carries every dataset GamePage requires */
    gameRenderable: boolean;
    /** ESPN's own status name, for the invalid-status branch */
    statusName: string | undefined;
    /** the header came from the API's payload because ESPN's cdn had nothing */
    headerFallback: boolean;
}

export type GameRouteResult = { redirect: string } | GameRouteData;

export async function loadGameRoute(Astro: AstroGlobal, league: League): Promise<GameRouteResult> {
    // shared components (header, links, logos) read the league from locals
    Astro.locals.league = league;
    const { id } = Astro.params;
    if (!id) {
        Astro.cache.set(false);
        Astro.response.headers.set("Cache-Control", "no-store");
        return { redirect: leaguePath(league, "/") };
    }
    // 'source-switch' (preview, utils/features.ts). This is the ONLY path that
    // sends `?source=` to the API and the only one that renders without ESPN's
    // cdn; with the flag off nothing below runs and the page, its request and
    // its cache key are byte-for-byte what they are today.
    const sourceSwitch = isFeatureEnabled('source-switch', Astro.locals);
    const source = sourceSwitch ? Astro.url.searchParams.get('source') ?? undefined : undefined;
    let espnGame: ESPNPlayByPlayResponse | null = null;
    let game: ProcessedGame | null = null;
    let headerFallback = false;
    try {
        const guarded = await retrieveGamePageGuarded(id, league);
        espnGame = guarded.page;
        if (!espnGame && sourceSwitch) {
            // ESPN's cdn failed AND the KV mirror was empty. The API can still
            // process the game (from an alternate source, or from its own ESPN
            // fetch, which is not rate-limited the way Worker egress is -- see
            // resources/espn.ts on the 403s), and its payload carries the same
            // `header` the page reads. Render from that instead of 500ing into
            // "Game Not Found".
            game = await retrieveProcessedGame(id, 30, league, source);
            espnGame = { gameId: Number(id), gamepackageJSON: { header: game.header } };
            headerFallback = true;
        }
        if (!espnGame) {
            throw new Error(`Game ID ${id} had no data`);
        }
        if (guarded.regressed) {
            // ESPN served a payload older than one we have already shown. Render it
            // (there is nothing fresher to render) but never let it be cached, or
            // the backwards state would persist for the whole TTL.
            console.warn(`stale ESPN payload for game ${id}: ${guarded.reason}`);
            const gop = gopStorage.getStore();
            if (gop) {
                gop.render_outcome = 'degraded';
                gop.events.push({ table: 'error_log', row: {
                    service: 'astro', level: 'warn',
                    message: `stale ESPN payload: ${guarded.reason}`.slice(0, 500),
                    stack: null, path: leaguePath(league, `/game/${id}`), game_id: String(id), context: null } });
            }
        }

        const config = getGameCacheConfig(espnGame.gamepackageJSON.header.competitions[0].date, espnGame.gamepackageJSON.header.competitions[0].status)
        if (!game && !ESPN_INVALID_GAME_STATUS_NAMES.includes(espnGame.gamepackageJSON.header.competitions[0].status.type.name)) {
            game = await retrieveProcessedGame(id, config.maxAge || 30, league, source);
        }

        if (guarded.regressed || headerFallback) {
            // Astro.cache.set(false) emits NO header, and Workers Caching treats a
            // header-less 200 as cacheable for a heuristic two hours -- longer than any
            // live TTL here. Opting out has to be explicit.
            Astro.cache.set(false);
            Astro.response.headers.set("Cache-Control", "no-store");
        } else {
            Astro.cache.set(config);
        }
    } catch (e: any) {
        console.error(`ERROR while retrieving game data: ${e}, ${e.stack}`);
        Astro.cache.set(false);
        Astro.response.headers.set("Cache-Control", "no-store");
    }

    const statusName = espnGame?.gamepackageJSON?.header?.competitions?.[0]?.status?.type?.name;
    // A game with no processed plays before/at kickoff is a pregame state, not a
    // GamePage render (401858212, 2026-09-07: DELAYED with an empty plays payload).
    const pregameState = ["STATUS_SCHEDULED", "STATUS_DELAYED"].includes(statusName ?? "")
        && (!game || !Array.isArray(game.plays) || game.plays.length === 0);
    const gameRenderable = !!game && evaluateManifest(GAME_PAGE_MANIFEST, game).requiredMissing.length === 0;
    return { league, id, espnGame, game, pregameState, gameRenderable, statusName, headerFallback };
}

export const espnPathFor = (league: League) => LEAGUES[league].espnPath;
