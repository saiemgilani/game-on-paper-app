/**
 * Page-side step of /nba/scatter: blazing-the-nets' readScatter over the Data API. One read, the
 * season's player rows; blazing's scatterPoints (copied) builds the 100+ FGA points with the
 * Nets flagged and each player's headshot for the Faces mode. Axes, marks, the filter and the
 * zoom are client state in ScatterExplorer.svelte.
 */
import type { AstroGlobal } from 'astro';
import { headshotsFromRows, playerSeasonsFromRows } from '../../nba/adapters';
import { scatterPoints } from '../../nba/data/scatter';
import { NETS_TEAM_ID } from '../../nba/data/teams';
import type { ScatterPoint } from '../../nba/scatterMetrics';
import { resolveSeason } from './home';
import { readSeasonRows } from './season';

export interface NbaScatterParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    points: ScatterPoint[];
}

export type NbaScatterPrep = { unavailable: true } | NbaScatterParams;

export async function prepareNbaScatter(Astro: AstroGlobal): Promise<NbaScatterPrep> {
    Astro.locals.league = 'nba';
    const resolved = resolveSeason(Astro);
    const rows = await readSeasonRows(Astro, resolved.season, '/nba/scatter');
    if (rows === null) return { unavailable: true };
    return { ...resolved, points: scatterPoints(playerSeasonsFromRows(rows), headshotsFromRows(rows), NETS_TEAM_ID) };
}
