/**
 * 'bball-series' + 'bball-share-card' (preview): `/<league>/series/<id>/card.png` for nba/wnba, the series page's 1200x630
 * card (python/share_card.py render_basketball_series), drawn from the series page's own playoff_series_games read (the
 * same cached request). `?variant=spoilerfree` is the page's `?spoilers=off` card.
 *
 * Not behind the flags (a link-preview crawler never carries the preview cookie), but inside the league's namespace gate
 * (middleware.ts), as the game card is; nothing links here while the flags are off. A decided series' card is held a
 * day, one in progress ten minutes, the spoiler-free card a day. The games-played `v` in the page's og:image URL is not
 * part of the cache key (cacheKey.ts), so a share after a game can see the previous card for up to those ten minutes.
 */
import type { APIContext, APIRoute } from 'astro';
import { seriesCardBody, SERIES_CARD_VARIANTS } from '../../basketball/seriesCard';
import { retrieveBasketballSeriesCard } from '../../resources/python';
import { retrieveRowsFrom } from '../../resources/sdv';
import { BASKETBALL } from '../../basketball/config';
import { NBA_READ_TIMEOUT_MS } from '../../resources/nbaGames';
import type { CardVariant } from '../../utils/shareTags';
import type { ProLeague } from '../../utils/playoffPicture';
import { parseSeriesId, type SeriesGameRow } from './series';

const NO_STORE = { 'Cache-Control': 'no-store' };
const DECIDED_MAX_AGE = 24 * 60 * 60;
const LIVE_MAX_AGE = 10 * 60;

/** Seconds a card is held: a day once decided, and always for the spoiler-free card (it never changes); else ten minutes. */
export function seriesCardMaxAge(variant: CardVariant, games: SeriesGameRow[]): number {
    return variant === 'spoilerfree' || games[games.length - 1].decided ? DECIDED_MAX_AGE : LIVE_MAX_AGE;
}

export function basketballSeriesCardRoute(league: ProLeague): APIRoute {
    return async ({ params, url, cache }: APIContext) => {
        const key = parseSeriesId(params.id);
        const variant = (url.searchParams.get('variant') ?? 'full') as CardVariant;
        if (!key || !SERIES_CARD_VARIANTS.includes(variant)) return new Response('Bad request', { status: 400, headers: NO_STORE });
        let games: SeriesGameRow[];
        try {
            games = await retrieveRowsFrom<SeriesGameRow>(BASKETBALL[league].gamesSource, 'playoff_series_games',
                { season: String(key.season), series_id: key.id, order: 'game_number', limit: '20' }, 6 * 60 * 60, true, NBA_READ_TIMEOUT_MS);
        } catch (e: any) {
            console.error(`ERROR while loading the ${league} series ${key.id} for a share card: ${e?.message ?? e}`);
            return new Response('Card unavailable', { status: 502, headers: NO_STORE });
        }
        if (games.length === 0) return new Response('Not found', { status: 404, headers: NO_STORE });
        // the spoiler-free card is sent no series score and no game, so the renderer cannot draw one
        const full = seriesCardBody(league, games);
        const body = variant === 'spoilerfree' ? { ...full, status: '', games: [] } : full;
        const png = await retrieveBasketballSeriesCard(league, key.id, variant, body);
        if (!png) return new Response('Card unavailable', { status: 502, headers: NO_STORE });
        const maxAge = seriesCardMaxAge(variant, games);
        try { cache?.set({ maxAge, tags: [league, 'share-card'] }); } catch { /* cache provider absent in dev and tests */ }
        return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${maxAge}` } });
    };
}
