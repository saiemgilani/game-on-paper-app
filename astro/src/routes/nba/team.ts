/**
 * Page-side step of /nba/team/[id]: blazing-the-nets' loadTeamPage + assembleTeamPage over the
 * Data API. The three reads (season players, league context, the team's shots) are all identity:
 * one failing is a 503. A malformed id, a team_id the season's rows do not name, or a team with
 * no regular-season shots is a 404 (blazing: teamsFromShots(shots)[0] undefined -> notFound).
 * The roster is sorted server-side (?sort=, ?dir=, ?mode=pergame|totals, all whitelisted).
 */
import type { AstroGlobal } from 'astro';
import { leagueContextFromRows, shotsFromRows } from '../../nba/adapters';
import { buildDashboard, type DashboardData } from '../../nba/dashboard';
import { shootingLine, type ShootingLine } from '../../nba/data/aggregate';
import type { Team } from '../../nba/data/teams';
import type { SortDir } from '../../nba/table';
import { ROSTER_COLUMNS, parseDir, parseMode, parseSort, rosterRows, sortRosterRows, teamsFromSeasonRows, type Mode, type RosterRow, type RosterSortKey } from '../../nba/tables';
import { retrieveLeagueContextRows, retrieveSeasonPlayerRows, retrieveTeamShots } from '../../resources/nbaShots';
import { PLAYER_CACHE, setCache, uncacheable } from './cache';
import { resolveSeason } from './home';

export interface NbaTeamParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    team: Team;
    line: ShootingLine;
    roster: RosterRow[];
    dashboard: DashboardData;
    sort: RosterSortKey;
    dir: SortDir;
    mode: Mode;
}

export type NbaTeamPrep = { notFound: true } | { unavailable: true } | NbaTeamParams;

const ROSTER_SORT_KEYS = ROSTER_COLUMNS.map((c) => c.key);

export async function prepareNbaTeam(Astro: AstroGlobal): Promise<NbaTeamPrep> {
    Astro.locals.league = 'nba';
    const id = Astro.params.id ?? '';
    if (!/^\d{1,10}$/.test(id)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const teamId = Number(id);
    const resolved = resolveSeason(Astro);
    const { season } = resolved;
    const sort = parseSort(ROSTER_SORT_KEYS, Astro.url.searchParams.get('sort'), 'fga');
    const dir = parseDir(Astro.url.searchParams.get('dir'));
    const mode = parseMode(Astro.url.searchParams.get('mode'));

    const reads = await Promise.allSettled([retrieveSeasonPlayerRows(season), retrieveLeagueContextRows(season), retrieveTeamShots(season, teamId)]);
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
    const team = teamsFromSeasonRows(rows, season).find((t) => t.team_id === teamId);
    const shots = shotsFromRows(shotsR.value);
    if (!team || shots.length === 0) {
        uncacheable(Astro);
        return { notFound: true };
    }
    setCache(Astro, PLAYER_CACHE);
    return {
        ...resolved,
        team,
        line: shootingLine(shots),
        roster: sortRosterRows(rosterRows(rows, teamId), sort, dir, mode),
        dashboard: buildDashboard(shots, leagueContextFromRows(contextR.value)),
        sort, dir, mode,
    };
}
