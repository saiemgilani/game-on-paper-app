/**
 * `/game/<id>/card.png` and the `/nfl` twin: the game's 1200x630 share card,
 * rendered by the API (python/share_card.py) and cached here by the card's state.
 *
 * Not behind 'share-card': a link-preview crawler never carries the preview
 * cookie and must be able to fetch the image a preview page points at. Nothing
 * links here while the flag is off.
 *
 * The state comes from ESPN, never from the URL: `?state=` only keeps cards of
 * different states under different URLs, so a URL that asks for `final` while
 * the game is live gets the live card under the live card's one-minute cache,
 * never a year-long one.
 *
 * A played card (live or final) is also kept in KV (`card:` keys in ESPN_API_CACHE,
 * beside the game's `gamestate:`/`gamecontent:` keys), written when the game page
 * loads (warmShareCards) and read first here. KV is global where the Workers cache is
 * per colo, so a crawler fetching the card from another region finds it, and never
 * waits on the play-by-play pipeline. A miss draws on demand, as before, and writes
 * the card back. Raw PNG bytes, not base64: KV stores an ArrayBuffer as-is, and a
 * card is ~40-100 KB against KV's 25 MiB value cap.
 */
import type { APIContext, APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { retrieveGamePageGuarded } from '../resources/espn';
import { APP_VERSION, cardPage, retrieveCardPage, retrieveShareCard, type ProcessedGame } from '../resources/python';
import { calculatePredictedPointMargin, calculatePredictedWinProb, retrieveTeamSummaries } from '../resources/sdv';
import { getGameCacheConfig } from '../utils/config';
import { CURRENT_YEAR, METRIC_YEAR } from '../utils/constants';
import { CARD_MAX_AGE, CARD_STATES, CARD_VARIANTS, cardCacheControl, cardLogoUrl, cardState, type CardState, type CardVariant } from '../utils/shareTags';
import type { League } from '../utils/league';
import { safeCachePut } from '../utils/misc';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** GOP's pregame projection, as the pregame page computes it (GameEssentials), or undefined. */
async function projection(header: any, league: League) {
    const comp = header.competitions[0];
    const side = (ha: string) => comp.competitors.find((c: any) => c.homeAway === ha)?.team?.id;
    const season: number = header.season?.year;
    // the pregame page's season choice: last season's tables until this one's exist
    const year = (season == CURRENT_YEAR && CURRENT_YEAR != METRIC_YEAR) ? METRIC_YEAR : season;
    const adjEpa = async (teamId: string | undefined) => {
        if (!teamId || !year) return undefined;
        try {
            return (await retrieveTeamSummaries({ season: year, team_id: Number(teamId), league, maxLookback: year }))?.[0]?.net_adj_epa ?? undefined;
        } catch {
            return undefined;
        }
    };
    const [home, away] = await Promise.all([adjEpa(side('home')), adjEpa(side('away'))]);
    const margin = calculatePredictedPointMargin(away, home, comp.neutralSite === true, league);
    return margin == null ? undefined : { margin, homeWinProb: calculatePredictedWinProb(margin, league) };
}

/** A played card's KV key: per game, state, variant and deploy (a new renderer redraws every card). */
export function cardKey(league: League, id: string | number, state: CardState, variant: CardVariant): string {
    return `card:${league === 'cfb' ? '' : `${league}:`}${id}:${state}:${variant}:${APP_VERSION}`;
}

/** The card kept in KV, or null on a miss or any KV failure (fail-open: the route draws one). */
async function keptCard(key: string): Promise<ArrayBuffer | null> {
    try {
        return await env.ESPN_API_CACHE.get(key, 'arrayBuffer');
    } catch (e) {
        console.error(`ERROR while reading share card ${key} from KV: ${e}`);
        return null;
    }
}

function cardLogos(league: League, header: any) {
    const teamId = (ha: string): string => header.competitions[0].competitors.find((c: any) => c.homeAway === ha)?.team?.id ?? '';
    return { home: cardLogoUrl(league, teamId('home')), away: cardLogoUrl(league, teamId('away')) };
}

/**
 * 'share-card' (preview): on a game page load, draw any played card KV lacks from the game the
 * page just processed, both variants, and keep it for its state (a live card a minute, a final
 * one for good). Run in waitUntil, after the page is sent. The API draws per game, state and
 * minute, not per viewer: a key already in KV is never redrawn. `header` is ESPN's; a processed
 * game in another state (the page's cache lags a transition) is skipped, as the route skips it.
 */
export async function warmShareCards(id: string | number, league: League, header: any, game: ProcessedGame): Promise<void> {
    try {
        const state = cardState(header.competitions[0].status);
        const page = cardPage(game);
        if (state === 'pre' || page.state !== state) return;
        const logos = cardLogos(league, header);
        await Promise.all(CARD_VARIANTS.map(async (variant) => {
            const key = cardKey(league, id, state, variant);
            if (await keptCard(key)) return;
            const png = await retrieveShareCard(id, league, state, variant, undefined, logos, page);
            if (png) await safeCachePut(env.ESPN_API_CACHE, key, png, CARD_MAX_AGE[state]);
        }));
    } catch (e) {
        console.error(`ERROR while warming share cards for ${league} ${id}: ${e}`);
    }
}

export function shareCardRoute(league: League): APIRoute {
    return async ({ params, url, cache }: APIContext) => {
        const id = params.id ?? '';
        const asked = url.searchParams.get('state');
        const variant = (url.searchParams.get('variant') ?? 'full') as CardVariant;
        if (!/^\d+$/.test(id) || (asked != null && !CARD_STATES.includes(asked as CardState)) || !CARD_VARIANTS.includes(variant)) {
            return new Response('Bad request', { status: 400, headers: NO_STORE });
        }
        const guarded = await retrieveGamePageGuarded(id, league);
        const header = guarded.page?.gamepackageJSON?.header;
        if (!header?.competitions?.[0]) return new Response('Not found', { status: 404, headers: NO_STORE });

        const state = cardState(header.competitions[0].status);
        const key = state === 'pre' ? null : cardKey(league, id, state, variant);
        const kept = key ? await keptCard(key) : null;
        if (kept) return cardResponse(kept, state, !guarded.regressed, cache);

        const logos = cardLogos(league, header);
        // A played card is drawn from the game the page already processed (same /process request,
        // same cache entry, same TTL as the page), so it costs the API drawing, not a second
        // play-by-play run.
        const comp = header.competitions[0];
        const page = state === 'pre' ? null : await retrieveCardPage(id, league, getGameCacheConfig(comp.date, comp.status).maxAge || 30);
        const png = await retrieveShareCard(id, league, state, variant, state === 'pre' ? await projection(header, league) : undefined, logos, page);
        if (!png) return new Response('Card unavailable', { status: 502, headers: NO_STORE });

        // Drawn but never kept: an ESPN payload older than one already shown, and a played card whose
        // plays are missing or were processed in another state (the page's cache lags a transition),
        // which would otherwise stand as the final card for a year.
        const keep = !guarded.regressed && (state === 'pre' || page?.state === state);
        if (keep && key) await safeCachePut(env.ESPN_API_CACHE, key, png, CARD_MAX_AGE[state]);
        return cardResponse(png, state, keep, cache);
    };
}

function cardResponse(png: ArrayBuffer, state: CardState, keep: boolean, cache: APIContext['cache']): Response {
    try {
        if (!keep) cache?.set(false);
        else cache?.set({ maxAge: CARD_MAX_AGE[state], tags: ['share-card'] });
    } catch { /* cache provider absent in dev and tests */ }
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': keep ? cardCacheControl(state) : 'no-store' } });
}
