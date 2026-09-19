/**
 * Page-side step of the individual player pages (`/players/[id]`, `/nfl/players/[id]`):
 * the league, the id shape, the season query param, and the one redirect the
 * NFL needs.
 *
 * Mirrors `routes/leaderboards.ts` -- the prep is pure-ish and testable, the
 * page file stays three lines, and a malformed id becomes a 404 instead of
 * reaching the Data API as garbage.
 */
import type { AstroGlobal } from 'astro';
import { leaguePath, type League } from '../utils/league';
import { isEspnAthleteId, isGsisId } from '../utils/players';
import { resolveEspnAthleteId, retrievePlayer, type SDVPlayer } from '../resources/sdv';

export interface PlayerParams {
    player: SDVPlayer;
    /** the season to show; always one the player actually has rows for. */
    season: number;
}

export type PlayerPrep = { redirect: string } | { notFound: true } | PlayerParams;

export async function preparePlayer(Astro: AstroGlobal, league: League): Promise<PlayerPrep> {
    Astro.locals.league = league;
    const id = Astro.params.id;
    if (!id) return { notFound: true };

    const seasonParam = Astro.url.searchParams.get('season');
    const season = seasonParam && /^\d{4}$/.test(seasonParam) ? parseInt(seasonParam) : null;
    const query = season ? `?season=${season}` : '';

    // The NFL season leaderboards key on gsis, so their rows can only link here
    // with a gsis id. Resolve it through the nflverse crosswalk ONCE and send the
    // reader to the canonical ESPN-id URL -- the id every other surface uses, and
    // the only one the Data API's player routes accept.
    if (league === 'nfl' && isGsisId(id)) {
        const espnId = await resolveEspnAthleteId(id);
        if (!espnId) return { notFound: true };
        return { redirect: leaguePath(league, `/players/${espnId}`) + query };
    }

    if (!isEspnAthleteId(id)) return { notFound: true };

    // The one fetch the ROUTE makes: the Data API 404s an id with no rows
    // anywhere, and that 404 has to become the site's 404 -- an identity shell
    // for a player who does not exist would be indexed as a thin page.
    const player = await retrievePlayer(id, league);
    if (!player) return { notFound: true };
    // a hand-typed season the player has no rows for is a 404 too; the pills
    // only ever offer seasons from `player.seasons`
    if (season !== null && !player.seasons.includes(season)) return { notFound: true };
    const shown = season ?? player.latest_season ?? player.seasons[0];
    if (shown === undefined || shown === null) return { notFound: true };
    return { player, season: Number(shown) };
}
