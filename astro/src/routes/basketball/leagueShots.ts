// src/routes/basketball/leagueShots.ts
/**
 * Page-side step of /<league>/shots (BB-G16, behind 'bball-league-shots'): every team's square shot chart on one page, small
 * multiples coloured as the team page's chart is. The NBA and WNBA show the whole league; a college league shows one
 * conference at a time (?conference=, the scatter's slugs and computed default), so a page reads at most ~18 teams.
 *
 * Reads: the season's player rows (the team list, shared with /teams), the league context (its exact `kind='square'` rows,
 * sdv-db #191, and the zone rates; shared with every team page) and sdv-db #221's `shot_team_context`, every team's squares
 * and line in ONE read (a college league: one per conference). The template is components/routes/LeagueShotsRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { quantile } from 'd3-array';
import { courtFor, type Court } from '../../basketball/config';
import {
    conferenceSlug, defaultScatterConference, filterByConference, isNcaaDashboards, scatterConferenceOptions, withSeasonMembers, type ConferenceOption,
} from '../../basketball/dashboards';
import { leagueContextFromRows, leagueSquaresFromRows, teamSquaresFromRows } from '../../nba/adapters';
import { squareCells, type SquareCell } from '../../nba/charts/hexShotChart';
import { SQUARE_SIDE } from '../../nba/dashboard';
import { binsVsLeague, LEAGUE_PRIOR_ATTEMPTS, shootingLine, type ShootingLine } from '../../nba/data/aggregate';
import { COURT } from '../../nba/data/court';
import type { Team } from '../../nba/data/teams';
import { teamsFromSeasonRows } from '../../nba/tables';
import { retrieveConferenceRows, retrieveLeagueContextRows, retrieveScheduleTeamRows, retrieveTeamContextRows, type TeamContextRow } from '../../resources/nbaShots';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { uncacheable } from './cache';
import { readBasketballSeasonRows, readCoverageNote, resolveBasketballSeason } from './season';

export interface LeagueShotsTeam {
    team: Team;
    line: ShootingLine;
    /** null: the team-square read failed (the card says so; the page is not cached) */
    cells: SquareCell[] | null;
}

export interface LeagueShotsParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    teams: LeagueShotsTeam[];
    side: number;
    /** attempts at which a square is full size, shared by every chart (the 95th percentile of the page's drawn cells) */
    cap: number;
    /** only a non-NBA court rides along, as buildDashboard's */
    court?: Court;
    /** college: the season's conferences and the one shown */
    conferences?: ConferenceOption[];
    conference?: string;
    coverage?: string | null;
    /** the league context had no square rows (sdv-db's derived tables not rebuilt): every square fell back to its zone rate */
    noLeagueSquares?: true;
}

export type LeagueShotsPrep = { unavailable: true } | LeagueShotsParams;

export async function prepareLeagueShots(Astro: AstroGlobal, league: BasketballLeague): Promise<LeagueShotsPrep> {
    Astro.locals.league = league;
    const resolved = resolveBasketballSeason(Astro, league);
    const { season } = resolved;
    const college = isNcaaDashboards(league);
    const coverageP = readCoverageNote(league, season);
    const contextP = retrieveLeagueContextRows(season, league);
    contextP.catch(() => {}); // handled below; keeps an early unavailable return from leaving an unhandled rejection
    const membershipP = college ? Promise.all([retrieveConferenceRows(season, league), retrieveScheduleTeamRows(season, league)]) : null;
    membershipP?.catch(() => {}); // as above
    // a pro league's one read starts now; a college league's waits for its conference's id
    let teamContextP: Promise<TeamContextRow[]> | null = college ? null : retrieveTeamContextRows(season, league);
    teamContextP?.catch(() => {}); // as above
    const rows = await readBasketballSeasonRows(Astro, league, season, leaguePath(league, '/shots'));
    if (rows === null) return { unavailable: true };

    let teams = teamsFromSeasonRows(rows, season, league);
    let conferences: ConferenceOption[] | undefined;
    let conference: string | undefined;
    let context;
    try {
        context = await contextP;
        if (membershipP) {
            const [c, games] = await membershipP;
            conferences = scatterConferenceOptions(c.teams, c.groups, season, league);
            const asked = Astro.url.searchParams.get('conference');
            const fallback = defaultScatterConference(rows, c.teams, season, league);
            // never 'all': a D-I season's team squares are over the read cap
            conference = conferences.find((o) => o.slug === asked)?.slug ?? conferences.find((o) => o.slug === fallback)?.slug ?? conferences[0]?.slug;
            const members = withSeasonMembers(teams, c.teams, games, season, league);
            teams = conference ? filterByConference(members, c.teams, conference).sort((a, b) => a.name.localeCompare(b.name)) : [];
            const conferenceId = conference ? c.teams.find((r) => conferenceSlug(r.conference_id) === conference)?.conference_id : undefined;
            teamContextP = conferenceId ? retrieveTeamContextRows(season, league, String(conferenceId)) : Promise.resolve([]);
        }
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} league context or conferences for the league shot page: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }

    const court = courtFor(league, season);
    const hexIndex = leagueContextFromRows(context).hexIndex;
    const leagueCells = leagueSquaresFromRows(context);
    if (leagueCells.length === 0 && rows.length > 0) {
        console.warn(`${league} ${season}: shot_league_context has no square rows; the league shot page colours by zone`);
        uncacheable(Astro);
    }

    let byTeam: ReturnType<typeof teamSquaresFromRows> | null = null;
    try {
        byTeam = teamSquaresFromRows(await teamContextP!);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} team shot squares: ${e}, ${e?.stack}`);
        uncacheable(Astro);
    }
    const out: LeagueShotsTeam[] = teams.map((team) => {
        if (!byTeam) return { team, line: shootingLine([]), cells: null };
        // no rows: a team with no shots, as an empty team read was
        const t = byTeam.get(team.team_id);
        if (!t) return { team, line: shootingLine([]), cells: [] };
        return { team, line: t.line, cells: squareCells(binsVsLeague(t.squares, hexIndex, SQUARE_SIDE, LEAGUE_PRIOR_ATTEMPTS, leagueCells), SQUARE_SIDE) };
    });

    const drawn = out.flatMap((t) => t.cells ?? []);
    const cap = Math.max(2, Math.ceil(quantile(drawn, 0.95, (c) => c[2]) ?? 2));
    const coverage = await coverageP;
    if (coverage === undefined) uncacheable(Astro);
    return {
        ...resolved,
        teams: out,
        side: SQUARE_SIDE,
        cap,
        ...(court === COURT ? {} : { court }),
        ...(college ? { conferences, conference, coverage: coverage ?? null } : {}),
        ...(leagueCells.length === 0 ? { noLeagueSquares: true as const } : {}),
    };
}
