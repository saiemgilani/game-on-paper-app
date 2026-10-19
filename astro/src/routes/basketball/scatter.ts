/**
 * Page-side step of /<league>/scatter: blazing-the-nets' readScatter over the Data API. One read, the
 * season's player rows; blazing's scatterPoints (copied) builds the points at the league-season's FGA bar with the
 * featured team flagged and each player's headshot for the Faces mode. Axes, marks, the filter and the
 * zoom are client state in ScatterExplorer.svelte.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL, rankMins } from '../../basketball/config';
import { headshotsFromRows, playerSeasonsFromRows } from '../../nba/adapters';
import type { RankMins } from '../../nba/data/ranks';
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
    /** the league-season's bars (rankMins): the NBA's 100 FGA / 50 3PA, scaled by season length */
    min: RankMins;
}

export type BasketballScatterPrep = { unavailable: true } | BasketballScatterParams;

export async function prepareBasketballScatter(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballScatterPrep> {
    Astro.locals.league = league;
    const cfg = BASKETBALL[league];
    const ft = cfg.featuredTeam;
    const resolved = resolveBasketballSeason(Astro, league);
    const rows = await readBasketballSeasonRows(Astro, league, resolved.season, leaguePath(league, '/scatter'));
    if (rows === null) return { unavailable: true };
    const min = rankMins(league, resolved.season);
    const points = scatterPoints(playerSeasonsFromRows(rows), headshotsFromRows(rows), ft?.statsTeamId ?? null, { colorOf: (id) => cfg.teams.inSeason(id, resolved.season)?.color, min });
    return { ...resolved, points, min };
}
