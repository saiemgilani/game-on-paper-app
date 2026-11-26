/**
 * 'bball-series' + 'bball-share-card' (preview): a playoff series page's link preview, as basketball/shareCard.ts is the
 * game page's. The image is the API's 1200x630 card (python/share_card.py render_basketball_series) at
 * `/<league>/series/<id>/card.png` (routes/basketball/seriesCard.ts), drawn from the body below: strings formatted from
 * the producer's playoff_series_games rows (the series page's own read), nothing summed. Two variants, as the game card:
 * `spoilerfree` (the page's `?spoilers=off`) draws the matchup and the round only.
 */
import { BASKETBALL, seasonLabelFor } from './config';
import type { CardVariant } from '../utils/shareTags';
import { LEAGUES, leaguePath, teamLogoUrl } from '../utils/league';
import type { ProLeague } from '../utils/playoffPicture';
import { seriesSide, seriesStatus, type SeriesGameRow } from '../routes/basketball/series';

export interface SeriesCardSide {
    id: number; abbr: string; name: string; color: string | null; alternateColor: string | null
    /** absolute: the API fetches art only from this site and ESPN's CDN (python/app.py LOGO_HOSTS) */
    logo: string
}

/** The POST body python/app.py's series card route reads: strings and the games' scores, nothing computed here. */
export interface SeriesCardBody {
    stamp: string
    a: SeriesCardSide
    b: SeriesCardSide
    status: string
    games: { label: string; a: number | null; b: number | null; winner: 'a' | 'b' | null }[]
}

function cardSide(league: ProLeague, games: SeriesGameRow[], id: number, season: number): SeriesCardSide {
    const s = seriesSide(games, id);
    const team = BASKETBALL[league].teams.byEspnId(id);
    return {
        id, abbr: s.abbreviation, name: s.name, color: team?.color?.replace('#', '') ?? null, alternateColor: null,
        logo: new URL(teamLogoUrl(league, id, false, season), 'https://gameonpaper.com').href,
    };
}

/** The card body for a series' game rows (in game order, as the page reads them). */
export function seriesCardBody(league: ProLeague, games: SeriesGameRow[]): SeriesCardBody {
    const last = games[games.length - 1];
    const a = cardSide(league, games, last.team_a_id, last.season);
    const b = cardSide(league, games, last.team_b_id, last.season);
    return {
        stamp: `${seasonLabelFor(league, last.season)} ${last.round_name ?? `${LEAGUES[league].shortName} Playoffs`}`,
        a, b,
        status: seriesStatus(last, seriesSide(games, last.team_a_id), seriesSide(games, last.team_b_id)),
        games: games.map((g) => {
            const aHome = g.home_team_id === last.team_a_id;
            return {
                label: `G${g.game_number}`,
                a: aHome ? g.home_score : g.away_score,
                b: aHome ? g.away_score : g.home_score,
                winner: g.winner_team_id == null ? null : g.winner_team_id === last.team_a_id ? 'a' : 'b',
            };
        }),
    };
}

/**
 * The og:image tags. The full card's URL carries the games played so far, so a share after the next game fetches a
 * fresh image; the spoiler-free card never changes, so its URL says nothing about the series.
 */
export function seriesShareImage(league: ProLeague, id: string, games: SeriesGameRow[], spoilerFree: boolean): { url: string; alt: string } {
    const last = games[games.length - 1];
    const a = seriesSide(games, last.team_a_id);
    const b = seriesSide(games, last.team_b_id);
    const base = `https://gameonpaper.com${leaguePath(league, `/series/${id}`)}/card.png`;
    const matchup = `${a.name} vs. ${b.name}, ${seasonLabelFor(league, last.season)} ${last.round_name ?? 'playoffs'}`;
    if (spoilerFree) return { url: `${base}?variant=spoilerfree`, alt: `${matchup}: series score hidden` };
    const played = games.filter((g) => g.completed).length;
    return { url: `${base}?variant=full&v=${played}`, alt: `${matchup}: ${seriesStatus(last, a, b)}, every game's score` };
}

export const SERIES_CARD_VARIANTS: readonly CardVariant[] = ['full', 'spoilerfree'];
