/**
 * 'bball-share-card' (preview), G-R5: `/<league>/players/<id>/card.png` and `/<league>/team/<id>/card.png` for
 * nba/wnba/mbb/wbb, the player and team pages' 1200x630 card (python/share_card.py render_basketball_stats), drawn
 * from the producer's season row the page itself reads: the season's shot_season_players rows (the player page's
 * identity read, the same cached request) or the team's team_strength row (the season block's, same request).
 *
 * Not behind 'bball-share-card' (a link-preview crawler never carries the preview cookie), but inside the league's
 * namespace gate (middleware.ts), as the game card is. Nothing links here while the flag is off.
 *
 * Held six hours in the Workers cache, the season pages' own hold (routes/basketball/cache.ts seasonCache): the rows
 * change with the nightly. No KV copy: a miss is two cached Data API reads and a ~1 s draw, never a play-by-play run.
 * ?season= picks the season as the page does (the latest listed one when absent or unknown).
 */
import type { APIContext, APIRoute } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { playerCardBody, playerRow, teamCardBody, type StatCardBody, type StatCardKind } from '../../basketball/statCard';
import { parseSeason } from '../../nba/seasons';
import { retrieveSeasonPlayerRows } from '../../resources/nbaShots';
import { retrieveBasketballStatCard } from '../../resources/python';
import { retrieveTeamStrength } from '../../resources/teamSeason';
import { LEAGUES, type BasketballLeague } from '../../utils/league';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ID = /^\d{1,12}$/;
export const STAT_CARD_MAX_AGE = 6 * 60 * 60;

/** The seasons the league's pages list (routes/basketball/season.ts resolveBasketballSeason). */
function seasonOf(league: BasketballLeague, param: string | null): number {
    const first = BASKETBALL[league].shotFirstSeason;
    const seasons = first === undefined ? LEAGUES[league].seasons : LEAGUES[league].seasons.filter((s) => s >= first);
    return parseSeason(param, seasons);
}

/** The card's body, or null for a subject the season has no row for (a 404). Throws when a read fails. */
export async function statCardBody(league: BasketballLeague, kind: StatCardKind, id: number, season: number): Promise<StatCardBody | null> {
    if (kind === 'players') {
        const row = playerRow(await retrieveSeasonPlayerRows(season, league), id);
        return row ? playerCardBody(row, league, season) : null;
    }
    const team = BASKETBALL[league].teams.inSeason(id, season);
    if (!team) return null;
    const row = await retrieveTeamStrength(league, season, id);
    return row ? teamCardBody(row, league, season, team) : null;
}

export function basketballStatCardRoute(league: BasketballLeague, kind: StatCardKind): APIRoute {
    return async ({ params, url, cache }: APIContext) => {
        const id = params.id ?? '';
        if (!ID.test(id)) return new Response('Bad request', { status: 400, headers: NO_STORE });
        let body: StatCardBody | null;
        try {
            body = await statCardBody(league, kind, Number(id), seasonOf(league, url.searchParams.get('season')));
        } catch (e: any) {
            console.error(`ERROR while loading the ${league} ${kind} ${id} for a share card: ${e?.message ?? e}`);
            return new Response('Card unavailable', { status: 502, headers: NO_STORE });
        }
        if (!body) return new Response('Not found', { status: 404, headers: NO_STORE });
        const png = await retrieveBasketballStatCard(league, kind, Number(id), body);
        if (!png) return new Response('Card unavailable', { status: 502, headers: NO_STORE });
        try { cache?.set({ maxAge: STAT_CARD_MAX_AGE, tags: [league, 'share-card'] }); } catch { /* cache provider absent in dev and tests */ }
        return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': `public, max-age=${STAT_CARD_MAX_AGE}` } });
    };
}
