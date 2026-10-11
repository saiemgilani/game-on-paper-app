// src/routes/nba/teams.ts
/**
 * Page-side step of /nba/teams: every team that shot in the season with its shooting line
 * (blazing-the-nets' app/teams/list/[season]/page.tsx). One read, the season's player rows,
 * summed per team; the template is components/routes/NbaTeamsRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import type { ShootingLine } from '../../nba/data/aggregate';
import type { Team } from '../../nba/data/teams';
import { teamLinesFromRows, teamsFromSeasonRows } from '../../nba/tables';
import { resolveSeason } from './home';
import { readSeasonRows } from './season';

export interface NbaTeamsParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    teams: Team[];
    lines: Map<number, ShootingLine>;
}

export type NbaTeamsPrep = { unavailable: true } | NbaTeamsParams;

export async function prepareNbaTeams(Astro: AstroGlobal): Promise<NbaTeamsPrep> {
    Astro.locals.league = 'nba';
    const resolved = resolveSeason(Astro);
    const rows = await readSeasonRows(Astro, resolved.season, '/nba/teams');
    if (rows === null) return { unavailable: true };
    return { ...resolved, teams: teamsFromSeasonRows(rows, resolved.season), lines: teamLinesFromRows(rows) };
}
