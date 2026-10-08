/**
 * 'share-card' (preview): the link-preview tags a game page emits.
 *
 * The image is the API's 1200x630 card (`/game/<id>/card.png`, python/share_card.py)
 * in place of ESPN's 400x400 one. Its URL names the card's state and variant, so a
 * platform that cached a live card under one URL can never show it as the final
 * card, and a live card's URL carries a five-minute bucket so a new share fetches a
 * fresh image. `spoilerFree` (the page's `?spoilers=off`) changes only these tags:
 * title, description and image say Final or Live and the date, never the score.
 */
import type { ESPNStatus } from '../resources/espn';
import { SPECIAL_IMAGES } from './constants';
import { leaguePath, teamLogoUrl, type League } from './league';
import { gameContext } from './seo';

export type CardState = 'pre' | 'live' | 'final';
export type CardVariant = 'full' | 'spoilerfree';
export const CARD_STATES: readonly CardState[] = ['pre', 'live', 'final'];
export const CARD_VARIANTS: readonly CardVariant[] = ['full', 'spoilerfree'];

/** How long a card may be cached: a final card never changes, a live one is a minute old at most. */
export const CARD_MAX_AGE: Record<CardState, number> = { final: 31536000, live: 60, pre: 3600 };

export function cardCacheControl(state: CardState): string {
    return `public, max-age=${CARD_MAX_AGE[state]}${state === 'final' ? ', immutable' : ''}`;
}

/**
 * The team art a card draws: GOP's own where the site overrides ESPN's (SPECIAL_IMAGES,
 * as DarkModeLogos applies it), else ESPN's logo. The card is white, so always the
 * light variant. The API fetches only from this site and ESPN's CDN.
 */
export function cardLogoUrl(league: League, teamId: string | number): string {
    const own = SPECIAL_IMAGES[String(teamId)];
    return own ? new URL(own, 'https://gameonpaper.com').href : teamLogoUrl(league, teamId, false);
}

/** Final once ESPN says completed, live while it is in progress, otherwise pregame (nothing scored yet). */
export function cardState(status: Pick<ESPNStatus, 'type'> | undefined): CardState {
    if (status?.type?.completed === true) return 'final';
    return status?.type?.state === 'in' ? 'live' : 'pre';
}

export interface ShareTagGame {
    id: string | number;
    league: League;
    state: CardState;
    /** rendered names, as the site prints them */
    away: string;
    home: string;
    awayScore?: string | number;
    homeScore?: string | number;
    /** ISO kickoff */
    date: string;
    season: number;
    week?: number;
    note?: string;
    /** the head's title and description today, used as they are for the full variant */
    title: string;
    description: string;
}

export interface ShareTags {
    /** og:url / twitter:url: the link's own address, so a platform that keys a preview on it never merges the two variants */
    url: string;
    title: string;
    description: string;
    image: string;
    imageAlt: string;
    /** false on the spoiler-free variant: the JSON-LD names the result */
    jsonLd: boolean;
}

export function shareTags(g: ShareTagGame, { spoilerFree, now = Date.now() }: { spoilerFree: boolean; now?: number }): ShareTags {
    const query = new URLSearchParams({ state: g.state, variant: spoilerFree ? 'spoilerfree' : 'full' });
    if (g.state === 'live') query.set('v', `live-${Math.floor(now / 1000 / 300)}`);
    const page = `https://gameonpaper.com${leaguePath(g.league, `/game/${g.id}`)}`;
    const image = `${page}/card.png?${query}`;
    const url = spoilerFree ? `${page}?spoilers=off` : page;
    const jsonLd = !spoilerFree;
    const matchup = `${g.away} @ ${g.home}`;
    if (g.state === 'pre') {
        // nothing to spoil: both variants are the pregame card and today's copy
        return { url, title: g.title, description: g.description, image, imageAlt: `${matchup}: matchup preview`, jsonLd };
    }
    if (!spoilerFree) {
        const scored = `${g.away} ${g.awayScore} @ ${g.home} ${g.homeScore}`;
        const alt = g.state === 'final' ? `${scored}, final: win probability chart and Deserved Win %` : `${scored}, live: win probability so far`;
        return { url, title: g.title, description: g.description, image, imageAlt: alt, jsonLd };
    }
    const label = g.state === 'final' ? 'Final' : 'Live';
    const when = new Date(g.date);
    const day = isNaN(when.getTime()) ? '' : ` on ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}`;
    return {
        url,
        jsonLd,
        title: `${matchup} / ${gameContext(g)} / Game on Paper`,
        description: `${label}${day}. The score is left out of this preview: open the game for win probability, EPA and every play.`,
        image,
        imageAlt: `${matchup}, ${label.toLowerCase()}: game excitement, score hidden`,
    };
}
