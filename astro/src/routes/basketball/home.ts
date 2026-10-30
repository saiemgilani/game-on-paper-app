/**
 * Page-side step of a basketball league's landing page (/nba): the season, the featured team's
 * roster for it and their headshots. The template is components/routes/NbaHomeRoute.astro. Served at
 * /<league>?season=<endYear>; an unlisted season resolves to the current one before any read, so a
 * crafted ?season= still caches its own copy of the current season's page (the key includes the query)
 * but never a different page. Only a 'featured-team' landing is served here.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { headshotsFromRows, playerSeasonsFromRows } from '../../nba/adapters';
import type { PlayerSeason } from '../../nba/data/players';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { readBasketballSeasonRows, resolveBasketballSeason } from './season';

export interface BasketballHomeParams {
    season: number;
    seasons: number[];
    current: number;
    /** the ?season= query for links ('' for the current season) */
    q: string;
    roster: PlayerSeason[];
    headshots: Map<number, string>;
}

export type BasketballHomePrep = { unavailable: true } | BasketballHomeParams;

export async function prepareBasketballHome(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballHomePrep> {
    Astro.locals.league = league;
    const cfg = BASKETBALL[league];
    const ft = cfg.featuredTeam;
    if (cfg.landing !== 'featured-team' || !ft) throw new Error(`${league}: no featured-team landing`);
    const resolved = resolveBasketballSeason(Astro, league);
    const rows = await readBasketballSeasonRows(Astro, league, resolved.season, leaguePath(league, '/'));
    if (rows === null) return { unavailable: true };
    return { ...resolved, roster: playerSeasonsFromRows(rows, ft.statsTeamId), headshots: headshotsFromRows(rows) };
}
