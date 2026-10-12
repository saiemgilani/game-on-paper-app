/**
 * Page-side step of /nba: the season, the Nets roster for it and their headshots. The template
 * is components/routes/NbaHomeRoute.astro. Served at /nba?season=<endYear>; an unlisted season
 * resolves to the current one before any read, so a crafted ?season= still caches its own copy
 * of the current season's page (the key includes the query) but never a different page.
 */
import type { AstroGlobal } from 'astro';
import { headshotsFromRows, playerSeasonsFromRows } from '../../nba/adapters';
import type { PlayerSeason } from '../../nba/data/players';
import { NETS_TEAM_ID } from '../../nba/data/teams';
import { seasonQuery } from '../../nba/links';
import { parseSeason, siteSeasons } from '../../nba/seasons';
import { readSeasonRows } from './season';

export interface NbaHomeParams {
    season: number;
    seasons: number[];
    current: number;
    /** the ?season= query for links ('' for the current season) */
    q: string;
    roster: PlayerSeason[];
    headshots: Map<number, string>;
}

export type NbaHomePrep = { unavailable: true } | NbaHomeParams;

/** The season a page shows, from `?season=` against the listed seasons. */
export function resolveSeason(Astro: AstroGlobal): { season: number; seasons: number[]; current: number; q: string } {
    const seasons = siteSeasons();
    const current = seasons[seasons.length - 1];
    const season = parseSeason(Astro.url.searchParams.get('season'), seasons);
    return { season, seasons, current, q: seasonQuery(season, current) };
}

export async function prepareNbaHome(Astro: AstroGlobal): Promise<NbaHomePrep> {
    Astro.locals.league = 'nba';
    const resolved = resolveSeason(Astro);
    const rows = await readSeasonRows(Astro, resolved.season, '/nba');
    if (rows === null) return { unavailable: true };
    return { ...resolved, roster: playerSeasonsFromRows(rows, NETS_TEAM_ID), headshots: headshotsFromRows(rows) };
}
