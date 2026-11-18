/**
 * 'bball-share-card' (preview): what a basketball game page's link preview is made of, football's 'share-card'
 * (utils/shareTags.ts) for nba/wnba/mbb/wbb. The image is the API's 1200x630 card (python/share_card.py
 * render_basketball) at `/<league>/game/<id>/card.png` (routes/basketball/shareCard.ts), drawn from the body below:
 * the game the page renders (Data API final, or the processor), slimmed to what the card draws.
 *
 * A live or final game only: a pregame page keeps the site's social card. One variant: no `?spoilers=off` yet.
 */
import type { NbaGame, NbaSide } from '../resources/nbaGame';
import { isFeatureEnabled } from '../utils/features';
import { cleanAbbreviation, cleanLocation } from '../utils/misc';
import { gameTitleText } from '../utils/gameTitle';
import { leaguePath, teamLogoUrl, type BasketballLeague } from '../utils/league';

export type BasketballCardState = 'live' | 'final';
export const BASKETBALL_CARD_STATES: readonly BasketballCardState[] = ['live', 'final'];

export interface BasketballCardSide {
    id: string; abbr: string; name: string; score: number | null; winner: boolean
    color: string | null; alternateColor: string | null
    /** absolute: the API fetches art only from this site and ESPN's CDN (python/app.py LOGO_HOSTS) */
    logo: string
}

/** The POST body python/app.py's basketball card route reads. `plays` are [period, home WP, game seconds remaining]. */
export interface BasketballCardBody {
    home: BasketballCardSide; away: BasketballCardSide
    /** ESPN's status detail: "Final", "Final/OT", "5:32 - 3rd Quarter" */
    detail: string | null
    date: string
    regulation: number
    plays: [number, number, number | null][]
    /** the game excitement index, a final's only; null on a live game and without the processor's excitement */
    gei: number | null
}

export function basketballCardState(game: Pick<NbaGame, 'status'>): BasketballCardState {
    return game.status.completed ? 'final' : 'live';
}

function side(s: NbaSide, league: BasketballLeague, season: number | null): BasketballCardSide {
    return {
        id: s.team.id, abbr: cleanAbbreviation(s.team), name: cleanLocation(s.team), score: s.score, winner: s.winner,
        color: s.team.color ?? null, alternateColor: s.team.alternateColor ?? null,
        // the page's light logo; the card is white
        logo: new URL(teamLogoUrl(league, s.team.id, false, season), 'https://gameonpaper.com').href,
    };
}

/**
 * The WP chart's own rule (NbaWinProbability.astro): a final whose excitement sdv-py also called complete, and only once
 * 'bball-gei' is 'on': the card is one image for every viewer (KV, the Workers cache, link previews), so it cannot follow a
 * preview cookie. A promotion is a deploy, and the deploy is in the card key, so kept cards redraw with it.
 */
function cardGei(game: NbaGame): number | null {
    const ex = game.excitement;
    return isFeatureEnabled('bball-gei', undefined) && game.status.completed && ex?.completed ? ex.gei : null;
}

export function basketballCardBody(game: NbaGame, league: BasketballLeague): BasketballCardBody {
    return {
        home: side(game.home, league, game.season), away: side(game.away, league, game.season),
        detail: game.status.detail, date: game.date, regulation: game.regulation,
        plays: game.plays.filter((p) => p.homeWinProb != null).map((p) => [p.period, p.homeWinProb as number, p.secondsRemaining]),
        gei: cardGei(game),
    };
}

/**
 * The og:image tags. The URL names the state, so a platform that cached a live card can never show it as the final,
 * and a live card's carries a five-minute bucket so a new share fetches a fresh image (as utils/shareTags.ts).
 */
export function basketballShareImage(game: NbaGame, league: BasketballLeague, now = Date.now()): { url: string; alt: string } {
    const state = basketballCardState(game);
    const query = new URLSearchParams({ state });
    if (state === 'live') query.set('v', `live-${Math.floor(now / 1000 / 300)}`);
    const scored = gameTitleText(game.away.team, game.home.team, game.away.score, game.home.score);
    // says what the card draws: the GEI only where the card has one
    const final = cardGei(game) == null ? `${scored}, final: win probability chart` : `${scored}, final: win probability chart and game excitement index`;
    return {
        url: `https://gameonpaper.com${leaguePath(league, `/game/${game.id}`)}/card.png?${query}`,
        alt: state === 'final' ? final : `${scored}, live: win probability so far`,
    };
}
