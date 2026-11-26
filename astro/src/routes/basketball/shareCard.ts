/**
 * 'bball-share-card' (preview): `/<league>/game/<id>/card.png` for nba/wnba/mbb/wbb, football's routes/shareCard.ts for
 * basketball. The card is drawn by the API (python/share_card.py render_basketball) from the game the page renders: an
 * ingested final from the Data API, else the processor's payload under the page's own cache TTL (the same cached request,
 * so a card never costs a second play-by-play run), and held as long as that payload (a day for a final; a Data API final
 * a year). Played cards only: a game before the tip, postponed or abandoned
 * (the states the page renders as pregame) is a 404.
 *
 * Not behind 'bball-share-card' (a link-preview crawler never carries the preview cookie), but inside the league's
 * namespace gate (middleware.ts), as the NFL card is inside 'nfl'. Nothing links here while the flag is off.
 *
 * The state is the game's, never the URL's (`?state=` only keeps states under different URLs). As football does, the
 * state is read first (the schedule row, else ESPN's page) and KV checked before the game is loaded. A kept card sits
 * under football's key shape, per source: `card:<league>:<id>:<state>:full:<deploy>` for a processor card,
 * `...:data_api` for a Data API final (which has no GEI yet), so one source's card is never served for the other.
 */
import type { APIContext, APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { BASKETBALL } from '../../basketball/config';
import { BASKETBALL_CARD_STATES, basketballCardBody, basketballCardState, type BasketballCardState } from '../../basketball/shareCard';
import { CARD_VARIANTS, type CardVariant } from '../../utils/shareTags';
import { ESPN_INVALID_GAME_STATUS_NAMES, retrieveGamePageGuarded } from '../../resources/espn';
import { fromDataApi, fromProcessor, isTrue, type NbaGame } from '../../resources/nbaGame';
import { retrieveNbaGameRows, retrieveNbaProcessedGame, retrieveNbaSchedule } from '../../resources/nbaGames';
import { ProcessorError, retrieveBasketballShareCard } from '../../resources/python';
import { getBasketballGameCacheConfig } from '../../utils/config';
import { CARD_MAX_AGE } from '../../utils/shareTags';
import type { BasketballLeague } from '../../utils/league';
import { safeCachePut } from '../../utils/misc';
import { cardKey, cardResponse, keptCard } from '../shareCard';
import { sanityGate } from './game';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ID = /^\d{6,12}$/;
const DATA_API = 'data_api';
/** the states the game page renders as pregame (routes/basketball/game.ts) */
const NO_PLAYS = ['STATUS_SCHEDULED', 'STATUS_DELAYED', ...ESPN_INVALID_GAME_STATUS_NAMES];

class NoCard extends Error {}

/** Draw the game's card, keep it for `maxAge` when `keep`, and answer with it. */
async function draw(league: BasketballLeague, id: string, game: NbaGame, key: string, keep: boolean, cache: APIContext['cache'], variant: CardVariant, maxAge?: number): Promise<Response> {
    const state = basketballCardState(game);
    const png = await retrieveBasketballShareCard(id, league, state, basketballCardBody(game, league), variant);
    if (!png) return new Response('Card unavailable', { status: 502, headers: NO_STORE });
    const ttl = maxAge ?? CARD_MAX_AGE[state];
    if (keep) await safeCachePut(env.ESPN_API_CACHE, key, png, ttl);
    return cardResponse(png, state, keep, cache, ttl);
}

async function card(league: BasketballLeague, id: string, cache: APIContext['cache'], variant: CardVariant): Promise<Response> {
    // 1. an ingested final (the page's step 1): the schedule row says final; the kept Data API card, else the rows
    let fellThrough = false;
    try {
        if (isTrue((await retrieveNbaSchedule(id, league))?.status_type_completed)) {
            const key = cardKey(league, id, 'final', variant, DATA_API);
            const kept = await keptCard(key);
            if (kept) return cardResponse(kept, 'final', true, cache);
            const rows = await retrieveNbaGameRows(id, league);
            if (!sanityGate(rows, league)) return await draw(league, id, fromDataApi(rows, league), key, true, cache, variant);
            fellThrough = true;
        }
    } catch (e: any) {
        fellThrough = true;
        console.warn(`${league} card ${id}: Data API unavailable (${e?.message ?? e}); falling through to the processor`);
    }

    // 2. ESPN's page for the state (the page's step 2)
    const guarded = await retrieveGamePageGuarded(id, league);
    if (!guarded.page && guarded.fetchFailed) throw new Error('ESPN unavailable'); // an outage, never "no such game"
    const comp = (guarded.page as any)?.gamepackageJSON?.header?.competitions?.[0];
    if (!comp?.status?.type || comp.status.type.state === 'pre' || NO_PLAYS.includes(comp.status.type.name)) throw new NoCard();
    const espnCompleted = comp.status.type.completed === true;
    const state: BasketballCardState = espnCompleted ? 'final' : 'live';
    // never kept where the page is not cached: a stale ESPN payload, a Data API final that failed its gate
    const keepable = !fellThrough && !guarded.regressed && guarded.fetchFailed !== true;
    const key = cardKey(league, id, state, variant);
    // a processor final is held as long as its page holds the payload (a day: late corrections, a GEI that lands after
    // ESPN's final), never the Data API final's year
    const config = getBasketballGameCacheConfig(comp.date, comp.status, BASKETBALL[league].scoreboardRefresh, league);
    const maxAge = state === 'final' && config.maxAge ? Math.min(config.maxAge, CARD_MAX_AGE.final) : CARD_MAX_AGE[state];
    const kept = await keptCard(key);
    if (kept) return cardResponse(kept, state, keepable, cache, maxAge);

    // 3. the processor (the page's step 3), under the page's TTL; no plays before ESPN calls the game is "no card yet"
    let game: NbaGame;
    try {
        game = fromProcessor(await retrieveNbaProcessedGame(id, config.maxAge || 30, league), league);
    } catch (e) {
        if (e instanceof ProcessorError && e.status === 404 && !espnCompleted) throw new NoCard();
        throw e;
    }
    // a payload processed in another state (it lags ESPN's transition) is drawn but never kept
    return draw(league, id, game, key, keepable && basketballCardState(game) === state, cache, variant, maxAge);
}

export function basketballShareCardRoute(league: BasketballLeague): APIRoute {
    return async ({ params, url, cache }: APIContext) => {
        const id = params.id ?? '';
        const asked = url.searchParams.get('state');
        const variant = (url.searchParams.get('variant') ?? 'full') as CardVariant;
        if (!ID.test(id) || (asked != null && !BASKETBALL_CARD_STATES.includes(asked as BasketballCardState)) || !CARD_VARIANTS.includes(variant)) {
            return new Response('Bad request', { status: 400, headers: NO_STORE });
        }
        try {
            return await card(league, id, cache, variant);
        } catch (e: any) {
            if (e instanceof NoCard) return new Response('Not found', { status: 404, headers: NO_STORE });
            console.error(`ERROR while loading the ${league} game ${id} for a share card: ${e?.message ?? e}`);
            return new Response('Card unavailable', { status: 502, headers: NO_STORE });
        }
    };
}
