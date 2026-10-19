/**
 * Page-side step of /<league>/team/[id]: blazing-the-nets' loadTeamPage + assembleTeamPage over the
 * Data API. The three reads (season players, league context, the team's shots) are all identity:
 * one failing is a 503. A malformed id, a team_id the season's rows do not name, or a team with
 * no regular-season shots is a 404 (blazing: teamsFromShots(shots)[0] undefined -> notFound).
 * The roster is sorted server-side (?sort=, ?dir=, ?mode=pergame|totals, all whitelisted).
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL, courtFor, placeholderFor } from '../../basketball/config';
import { isNcaaDashboards, withSeasonMembers } from '../../basketball/dashboards';
import { leagueContextFromRows, shotsFromRows } from '../../nba/adapters';
import { buildDashboard, type DashboardData } from '../../nba/dashboard';
import { shootingLine, type ShootingLine } from '../../nba/data/aggregate';
import type { Team } from '../../nba/data/teams';
import type { SortDir } from '../../nba/table';
import { ROSTER_COLUMNS, parseDir, parseMode, parseSort, rosterRows, sortRosterRows, teamsFromSeasonRows, type Mode, type RosterRow, type RosterSortKey } from '../../nba/tables';
import { retrieveConferenceRows, retrieveLeagueContextRows, retrieveScheduleTeamRows, retrieveSeasonPlayerRows, retrieveTeamShots } from '../../resources/nbaShots';
import type { BasketballLeague } from '../../utils/league';
import { playerCache, setCache, uncacheable } from './cache';
import { readCoverageNote, resolveBasketballSeason } from './season';

export interface BasketballTeamParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    team: Team;
    line: ShootingLine;
    roster: RosterRow[];
    /** null only with `empty` */
    dashboard: DashboardData | null;
    sort: RosterSortKey;
    dir: SortDir;
    mode: Mode;
    /** a college season's shot_coverage sentence (D24); absent for the NBA/WNBA */
    coverage?: string | null;
    /** college: a season member with no linked shot */
    empty?: true;
}

export type BasketballTeamPrep = { notFound: true } | { unavailable: true } | BasketballTeamParams;

const ROSTER_SORT_KEYS = ROSTER_COLUMNS.map((c) => c.key);

export async function prepareBasketballTeam(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballTeamPrep> {
    Astro.locals.league = league;
    const id = Astro.params.id ?? '';
    if (!/^\d{1,10}$/.test(id)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const teamId = Number(id);
    const resolved = resolveBasketballSeason(Astro, league);
    const { season } = resolved;
    const sortKeys = BASKETBALL[league].hidePie ? ROSTER_SORT_KEYS.filter((k) => k !== 'pie') : ROSTER_SORT_KEYS;
    const sort = parseSort(sortKeys, Astro.url.searchParams.get('sort'), 'fga');
    const dir = parseDir(Astro.url.searchParams.get('dir'));
    const mode = parseMode(Astro.url.searchParams.get('mode'));

    const coverageP = readCoverageNote(league, season);
    const reads = await Promise.allSettled([retrieveSeasonPlayerRows(season, league), retrieveLeagueContextRows(season, league), retrieveTeamShots(season, teamId, league)]);
    const [playersR, contextR, shotsR] = reads;
    for (const [name, r] of [['season players', playersR], ['league context', contextR], ['team shots', shotsR]] as const) {
        if (r.status === 'rejected') {
            console.error(`ERROR while loading ${name} for team ${teamId}, ${season}: ${r.reason}`);
            uncacheable(Astro);
            return { unavailable: true };
        }
    }
    if (playersR.status !== 'fulfilled' || contextR.status !== 'fulfilled' || shotsR.status !== 'fulfilled') return { unavailable: true };

    const rows = playersR.value;
    const team = teamsFromSeasonRows(rows, season, league).find((t) => t.team_id === teamId);
    const shots = shotsFromRows(shotsR.value);
    const coverage = await coverageP;
    if (!team || shots.length === 0) {
        // college (D43/D47, R7): a season MEMBER with no linked shot is a page that says so; a non-member (Hartford 2026: ESPN
        // lists it, no conference row) is a 404. The membership reads happen only on this branch. The NBA/WNBA keep the 404.
        let member: Team | undefined;
        if (isNcaaDashboards(league) && !team && shots.length === 0) {
            try {
                const [c, games] = await Promise.all([retrieveConferenceRows(season, league), retrieveScheduleTeamRows(season, league)]);
                member = withSeasonMembers([], c.teams, games, season, league).find((t) => t.team_id === teamId);
            } catch (e: any) {
                console.error(`ERROR while reading the ${league} ${season} membership for team ${teamId}: ${e}, ${e?.stack}`);
            }
        }
        if (!member) {
            uncacheable(Astro); // a failed membership read is a 404 that is never cached
            return { notFound: true };
        }
        setCache(Astro, playerCache(league));
        if (coverage === undefined) uncacheable(Astro);
        return { ...resolved, team: member, line: shootingLine([]), roster: [], dashboard: null, sort, dir, mode, empty: true as const, coverage: coverage ?? null };
    }
    setCache(Astro, playerCache(league));
    // the picker lists only the franchise's seasons (Golden State: 2025-2026), so no option is a 404; the NBA's: all of them
    const own = BASKETBALL[league].teams.seasonsOf(teamId, season);
    if (coverage === undefined) uncacheable(Astro);
    return {
        ...resolved,
        seasons: own ? resolved.seasons.filter((s) => own.includes(s)) : resolved.seasons,
        team,
        line: shootingLine(shots),
        roster: sortRosterRows(rosterRows(rows, teamId), sort, dir, mode),
        dashboard: buildDashboard(shots, leagueContextFromRows(contextR.value), courtFor(league, season), placeholderFor(league, season)),
        sort, dir, mode,
        ...(isNcaaDashboards(league) ? { coverage: coverage ?? null } : {}),
    };
}
