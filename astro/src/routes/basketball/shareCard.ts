/**
 * 'bball-share-card' (preview): `/<league>/game/<id>/card.png` for nba/wnba/mbb/wbb, football's routes/shareCard.ts for
 * basketball. The card is drawn by the API (python/share_card.py render_basketball) from the game the page renders: an
 * ingested final from the Data API, else the processor's payload under the page's own cache TTL (the same cached request,
 * so a card never costs a second play-by-play run). Played cards only: a game before the tip is a 404.
 *
 * Not behind 'bball-share-card' (a link-preview crawler never carries the preview cookie), but inside the league's
 * namespace gate (middleware.ts), as the NFL card is inside 'nfl'. Nothing links here while the flag is off.
 *
 * The state is the game's, never the URL's (`?state=` only keeps states under different URLs). A kept card sits in KV
 * under football's key shape (`card:<league>:<id>:<state>:full:<deploy>`) and in the Workers cache for its state.
 */
import type { APIContext, APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { BASKETBALL } from '../../basketball/config';
import { BASKETBALL_CARD_STATES, basketballCardBody, basketballCardState, type BasketballCardState } from '../../basketball/shareCard';
import { retrieveGamePageGuarded } from '../../resources/espn';
import { fromDataApi, fromProcessor, isTrue, type NbaGame } from '../../resources/nbaGame';
import { retrieveNbaGameRows, retrieveNbaProcessedGame, retrieveNbaSchedule } from '../../resources/nbaGames';
import { retrieveBasketballShareCard } from '../../resources/python';
import { getBasketballGameCacheConfig } from '../../utils/config';
import { CARD_MAX_AGE } from '../../utils/shareTags';
import type { BasketballLeague } from '../../utils/league';
import { safeCachePut } from '../../utils/misc';
import { cardKey, cardResponse, keptCard } from '../shareCard';
import { sanityGate } from './game';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ID = /^\d{6,12}$/;

/**
 * The game the page renders (routes/basketball/game.ts prepareGame, steps 1-3, without its panels or cache policy), or
 * null before the tip. `keep` is false where the page itself is not cached: a stale ESPN payload, a processor payload that
 * still reads live after ESPN called the game, a Data API final that failed its sanity gate.
 */
async function cardGame(id: string, league: BasketballLeague): Promise<{ game: NbaGame; keep: boolean } | null> {
    let fellThrough = false;
    try {
        if (isTrue((await retrieveNbaSchedule(id, league))?.status_type_completed)) {
            const rows = await retrieveNbaGameRows(id, league);
            if (!sanityGate(rows, league)) return { game: fromDataApi(rows, league), keep: true };
            fellThrough = true;
        }
    } catch (e: any) {
        fellThrough = true;
        console.warn(`${league} card ${id}: Data API unavailable (${e?.message ?? e}); falling through to the processor`);
    }
    const guarded = await retrieveGamePageGuarded(id, league);
    if (!guarded.page && guarded.fetchFailed) throw new Error('ESPN unavailable'); // an outage, never "no such game"
    const comp = (guarded.page as any)?.gamepackageJSON?.header?.competitions?.[0];
    if (!comp?.status?.type || comp.status.type.state === 'pre') return null;
    const config = getBasketballGameCacheConfig(comp.date, comp.status, BASKETBALL[league].scoreboardRefresh, league);
    const game = fromProcessor(await retrieveNbaProcessedGame(id, config.maxAge || 30, league), league);
    const stale = guarded.regressed || guarded.fetchFailed === true || (comp.status.type.completed === true && !game.status.completed);
    return { game, keep: !fellThrough && !stale };
}

export function basketballShareCardRoute(league: BasketballLeague): APIRoute {
    return async ({ params, url, cache }: APIContext) => {
        const id = params.id ?? '';
        const asked = url.searchParams.get('state');
        if (!ID.test(id) || (asked != null && !BASKETBALL_CARD_STATES.includes(asked as BasketballCardState))) {
            return new Response('Bad request', { status: 400, headers: NO_STORE });
        }
        let loaded: Awaited<ReturnType<typeof cardGame>>;
        try {
            loaded = await cardGame(id, league);
        } catch (e: any) {
            console.error(`ERROR while loading the ${league} game ${id} for a share card: ${e?.message ?? e}`);
            return new Response('Card unavailable', { status: 502, headers: NO_STORE });
        }
        if (!loaded) return new Response('Not found', { status: 404, headers: NO_STORE });

        const state = basketballCardState(loaded.game);
        const key = cardKey(league, id, state, 'full');
        const kept = await keptCard(key);
        if (kept) return cardResponse(kept, state, true, cache);

        const png = await retrieveBasketballShareCard(id, league, state, basketballCardBody(loaded.game, league));
        if (!png) return new Response('Card unavailable', { status: 502, headers: NO_STORE });
        if (loaded.keep) await safeCachePut(env.ESPN_API_CACHE, key, png, CARD_MAX_AGE[state]);
        return cardResponse(png, state, loaded.keep, cache);
    };
}
