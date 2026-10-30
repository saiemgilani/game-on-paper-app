/**
 * Page-side step of /<league>/scatter: blazing-the-nets' readScatter over the Data API. One read, the
 * season's player rows; blazing's scatterPoints (copied) builds the 100+ FGA points with the
 * featured team flagged and each player's headshot for the Faces mode. Axes, marks, the filter and the
 * zoom are client state in ScatterExplorer.svelte.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { headshotsFromRows, playerSeasonsFromRows } from '../../nba/adapters';
import { scatterPoints } from '../../nba/data/scatter';
import type { ScatterPoint } from '../../nba/scatterMetrics';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { readBasketballSeasonRows, resolveBasketballSeason } from './season';

export interface BasketballScatterParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    points: ScatterPoint[];
}

export type BasketballScatterPrep = { unavailable: true } | BasketballScatterParams;

export async function prepareBasketballScatter(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballScatterPrep> {
    Astro.locals.league = league;
    const ft = BASKETBALL[league].featuredTeam;
    const resolved = resolveBasketballSeason(Astro, league);
    const rows = await readBasketballSeasonRows(Astro, league, resolved.season, leaguePath(league, '/scatter'));
    if (rows === null) return { unavailable: true };
    // ponytail: 0 is no team, so no highlight; plan #6 makes the island's highlight optional
    return { ...resolved, points: scatterPoints(playerSeasonsFromRows(rows), headshotsFromRows(rows), ft?.statsTeamId ?? 0) };
}
