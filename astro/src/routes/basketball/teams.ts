// src/routes/basketball/teams.ts
/**
 * Page-side step of /<league>/teams: every team that shot in the season with its shooting line
 * (blazing-the-nets' app/teams/list/[season]/page.tsx). One read, the season's player rows,
 * summed per team; the template is components/routes/NbaTeamsRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { placeholderFor } from '../../basketball/config';
import { conferenceGroups, isNcaaDashboards, withSeasonMembers, type ConferenceGroup } from '../../basketball/dashboards';
import type { ShootingLine } from '../../nba/data/aggregate';
import type { Team } from '../../nba/data/teams';
import { teamLinesFromRows, teamsFromSeasonRows } from '../../nba/tables';
import { retrieveConferenceRows, retrieveLeagueContextRows, retrieveScheduleTeamRows } from '../../resources/nbaShots';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { uncacheable } from './cache';
import { readBasketballSeasonRows, readCoverageNote, resolveBasketballSeason } from './season';

export interface BasketballTeamsParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    teams: Team[];
    lines: Map<number, ShootingLine>;
    /** D29: the league total row's placeholder_shots / attempts; only for a league with a placeholderLocation */
    unlocated?: { count: number; total: number };
    /** a college season's shot_coverage sentence (D24); absent for the NBA/WNBA */
    coverage?: string | null;
    /** college: the season's members by conference; null when a reference read failed (plan #6's cards) */
    conferences?: ConferenceGroup[] | null;
}

export type BasketballTeamsPrep = { unavailable: true } | BasketballTeamsParams;

/** `landing`: the league root's teams index (/wnba); the read's route label is the root, the params are the same. */
export async function prepareBasketballTeams(Astro: AstroGlobal, league: BasketballLeague, { landing = false }: { landing?: boolean } = {}): Promise<BasketballTeamsPrep> {
    Astro.locals.league = league;
    const resolved = resolveBasketballSeason(Astro, league);
    const coverageP = readCoverageNote(league, resolved.season);
    const conferencesP = isNcaaDashboards(league) ? retrieveConferenceRows(resolved.season, league) : null;
    conferencesP?.catch(() => {}); // handled by the try below; this only keeps an early unavailable return from leaving an unhandled rejection
    const gamesP = isNcaaDashboards(league) ? retrieveScheduleTeamRows(resolved.season, league) : null;
    gamesP?.catch(() => {}); // handled by the try below; this only keeps an early unavailable return from leaving an unhandled rejection
    const rows = await readBasketballSeasonRows(Astro, league, resolved.season, leaguePath(league, landing ? '/' : '/teams'));
    if (rows === null) return { unavailable: true };
    const teams = teamsFromSeasonRows(rows, resolved.season, league);
    let conferences: ConferenceGroup[] | null | undefined;
    if (isNcaaDashboards(league)) {
        try {
            const [c, games] = await Promise.all([conferencesP!, gamesP!]);
            // D43/D47 (R7): the index is the season's members, with or without linked shots
            conferences = conferenceGroups(withSeasonMembers(teams, c.teams, games, resolved.season, league), c.teams, c.groups);
        } catch (e: any) {
            console.error(`ERROR while loading the ${league} conferences or schedule for ${resolved.season}: ${e}, ${e?.stack}`);
            conferences = null; // decorative: render plan #6's teams-with-shots cards, uncacheable below
        }
    }
    // D29: the league-wide count plan #3 keeps on the league-context total row; only a league with a placeholder location reads it
    let unlocated: { count: number; total: number } | undefined;
    if (placeholderFor(league, resolved.season)) {   // R22: only placeholder seasons
        try {
            const t = (await retrieveLeagueContextRows(resolved.season, league)).find((r) => r.kind === 'total');
            if (t?.placeholder_shots == null) {
                console.warn(`${league} teams ${resolved.season}: league context has no total row placeholder_shots for the placeholder note`);
                uncacheable(Astro); // incomplete context: as a failed read
            } else if (t.placeholder_shots > 0) unlocated = { count: t.placeholder_shots, total: t.attempts };
        } catch (e: any) {
            console.warn(`${league} teams ${resolved.season}: league context unavailable for the placeholder note (${e?.message ?? e})`);
            uncacheable(Astro); // the page without its note must not be held for the season window
        }
    }
    const coverage = await coverageP;
    if (coverage === undefined) uncacheable(Astro);
    if (conferences === null) uncacheable(Astro);
    return { ...resolved, teams, lines: teamLinesFromRows(rows), ...(unlocated ? { unlocated } : {}), ...(isNcaaDashboards(league) ? { coverage: coverage ?? null } : {}), ...(conferences === undefined ? {} : { conferences }) };
}
