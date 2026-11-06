// src/routes/basketball/teams.ts
/**
 * Page-side step of /<league>/teams: every team that shot in the season with its shooting line
 * (blazing-the-nets' app/teams/list/[season]/page.tsx). One read, the season's player rows,
 * summed per team; the template is components/routes/NbaTeamsRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import type { ShootingLine } from '../../nba/data/aggregate';
import type { Team } from '../../nba/data/teams';
import { teamLinesFromRows, teamsFromSeasonRows } from '../../nba/tables';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { readBasketballSeasonRows, resolveBasketballSeason } from './season';

export interface BasketballTeamsParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    teams: Team[];
    lines: Map<number, ShootingLine>;
}

export type BasketballTeamsPrep = { unavailable: true } | BasketballTeamsParams;

export async function prepareBasketballTeams(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballTeamsPrep> {
    Astro.locals.league = league;
    const resolved = resolveBasketballSeason(Astro, league);
    const rows = await readBasketballSeasonRows(Astro, league, resolved.season, leaguePath(league, '/teams'));
    if (rows === null) return { unavailable: true };
    return { ...resolved, teams: teamsFromSeasonRows(rows, resolved.season), lines: teamLinesFromRows(rows) };
}
