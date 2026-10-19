/**
 * Page-side step of /<league>/team/[id]: blazing-the-nets' loadTeamPage + assembleTeamPage over the
 * Data API. The three reads (season players, league context, the team's shots) are all identity:
 * one failing is a 503. A malformed id, a team_id the season's rows do not name, or a team with
 * no regular-season shots is a 404 (blazing: teamsFromShots(shots)[0] undefined -> notFound).
 * The roster is sorted server-side (?sort=, ?dir=, ?mode=pergame|totals, all whitelisted).
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL, courtFor, placeholderFor } from '../../basketball/config';
import { isNcaaDashboards, memberSeasonsOf, withSeasonMembers } from '../../basketball/dashboards';
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
    // college (D43/D47, R7): membership decides the page, so its two reads start beside the identity reads
    const membershipP = isNcaaDashboards(league) ? Promise.all([retrieveConferenceRows(season, league), retrieveScheduleTeamRows(season, league)]) : null;
    membershipP?.catch(() => {}); // handled below; this only keeps an early unavailable return from leaving an unhandled rejection
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
    const hasShots = team !== undefined && shots.length > 0;
    let member: Team | undefined = team;
    if (membershipP) {
        // a season MEMBER with no linked shot is a page that says so; a non-member is a 404 with or without shots (Hartford 2026:
        // ESPN lists it, no conference row), as the index leaves it out. A failed read is the 503 (R-P12): never "gone".
        try {
            const [c, games] = await membershipP;
            member = withSeasonMembers(team ? [team] : [], c.teams, games, season, league).find((t) => t.team_id === teamId);
        } catch (e: any) {
            console.error(`ERROR while reading the ${league} ${season} membership for team ${teamId}: ${e}, ${e?.stack}`);
            uncacheable(Astro);
            return { unavailable: true };
        }
    }
    if (!member || (!membershipP && !hasShots)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    setCache(Astro, playerCache(league));
    if (coverage === undefined) uncacheable(Astro);
    // the picker lists only the franchise's seasons (Golden State: 2025-2026), so no option is a 404; the NBA's: all of them;
    // college: the team's member seasons (R-P11), already filtered from resolved.seasons
    const members = memberSeasonsOf(league, teamId, season, resolved.seasons);
    const own = members ? undefined : BASKETBALL[league].teams.seasonsOf(teamId, season);
    const seasons = members ?? (own ? resolved.seasons.filter((s) => own.includes(s)) : resolved.seasons);
    if (!hasShots) {
        return { ...resolved, seasons, team: member, line: shootingLine([]), roster: [], dashboard: null, sort, dir, mode, empty: true as const, coverage: coverage ?? null };
    }
    return {
        ...resolved,
        seasons,
        team: member,
        line: shootingLine(shots),
        roster: sortRosterRows(rosterRows(rows, teamId), sort, dir, mode),
        dashboard: buildDashboard(shots, leagueContextFromRows(contextR.value), courtFor(league, season), placeholderFor(league, season)),
        sort, dir, mode,
        ...(isNcaaDashboards(league) ? { coverage: coverage ?? null } : {}),
    };
}
