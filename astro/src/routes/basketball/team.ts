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
import { retrieveConferenceRows, retrieveLeagueContextRows, retrieveScheduleTeamRows, retrieveSeasonPlayerRows, retrieveTeamShots, type SeasonPlayerRow } from '../../resources/nbaShots';
import { retrieveLineups } from '../../resources/lineups';
import { retrieveSituational } from '../../resources/situational';
import { retrieveTeamSeason, type TeamSeasonReads } from '../../resources/teamSeason';
import { isFeatureEnabled } from '../../utils/features';
import { parseBasis, parseGate, parseLineupSort, parseUnit, playerNames, playerPages, sortUnits, unitLabels, type LineupsTab } from '../../utils/lineups';
import { nameRows, parseSituation, situationsFor, type SituationsTab } from '../../utils/situations';
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
    /** college (R-S14): a member whose placed shots name no player (New Orleans 2443): the dashboard, no roster, no players link */
    noPlayers?: true;
    /** BB-G5, only with 'bball-team-season' on: the season block's reads; null when one failed (the block says so) */
    seasonBlock?: TeamSeasonReads | null;
    /** BB-G3, only with 'bball-lineups' on: the Lineups tab's controls and units; `units` null when a read failed */
    lineups?: LineupsTab;
    /** BB-G25, only with 'bball-situational' on: the Situations section's control and rows; `reads` null when a read failed */
    situations?: SituationsTab;
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
    // R-S14: membership + placed shots decide the page, not season-player rows (an NBA/WNBA team with shots always has rows)
    const hasShots = shots.length > 0;
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
    // read only once the page will render: a 404 or 503 never spends the five reads
    const flagged = isFeatureEnabled('bball-team-season', Astro.locals);
    const lineupsOn = isFeatureEnabled('bball-lineups', Astro.locals);
    const situationsOn = isFeatureEnabled('bball-situational', Astro.locals);
    const [seasonBlock, lineups, situations] = await Promise.all([
        flagged ? readSeasonBlock(league, season, teamId) : undefined,
        lineupsOn ? readLineups(Astro, league, season, teamId, rows) : undefined,
        situationsOn ? readSituations(Astro, league, season, teamId, rows) : undefined,
    ]);
    // the block and the tabs are decorative: a failed read renders the rest of the page, never cached
    if (seasonBlock === null || lineups?.units === null || situations?.reads === null) uncacheable(Astro);
    const block = { ...(flagged ? { seasonBlock } : {}), ...(lineupsOn ? { lineups } : {}), ...(situationsOn ? { situations } : {}) };
    // the picker lists only the franchise's seasons (Golden State: 2025-2026), so no option is a 404; the NBA's: all of them;
    // college: the team's member seasons (R-P11), already filtered from resolved.seasons
    const members = memberSeasonsOf(league, teamId, season, resolved.seasons);
    const own = members ? undefined : BASKETBALL[league].teams.seasonsOf(teamId, season);
    const seasons = members ?? (own ? resolved.seasons.filter((s) => own.includes(s)) : resolved.seasons);
    if (!hasShots) {
        return { ...resolved, seasons, team: member, line: shootingLine([]), roster: [], dashboard: null, sort, dir, mode, empty: true as const, coverage: coverage ?? null, ...block };
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
        ...(team ? {} : { noPlayers: true as const }),
        ...block,
    };
}

/** The season block's reads (BB-G5); null when any failed. The NBA/WNBA season tables are keyed by the stats id, the games by ESPN's. */
async function readSeasonBlock(league: BasketballLeague, season: number, teamId: number): Promise<TeamSeasonReads | null> {
    const espnId = BASKETBALL[league].teams.inSeason(teamId, season)?.espn_id ?? (BASKETBALL[league].currentMembers ? teamId : 0);
    try {
        if (!espnId) throw new Error('no ESPN id for the team-season');
        return await retrieveTeamSeason(league, season, teamId, espnId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} season block for team ${teamId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/**
 * The Lineups tab (BB-G3): ?unit=, ?basis=, ?min= and ?lsort=/?ldir=, the unit size's read over the gate, sorted, each
 * unit's names and player links; `units` null when a read failed.
 */
async function readLineups(Astro: AstroGlobal, league: BasketballLeague, season: number, teamId: number, rows: SeasonPlayerRow[]): Promise<LineupsTab> {
    const q = Astro.url.searchParams;
    const unit = parseUnit(q.get('unit'));
    const basis = parseBasis(q.get('basis'), league);
    const controls = { unit, basis, gate: parseGate(q.get('min'), league), sort: parseLineupSort(q.get('lsort'), basis), dir: parseDir(q.get('ldir')) };
    try {
        const read = await retrieveLineups(league, season, teamId, unit, controls.gate);
        const college = isNcaaDashboards(league);
        const units = sortUnits(read.units, controls.sort, controls.dir);
        // the season rows are ESPN-keyed in college: they name no unit (stats.ncaa.org ids), they only say which pages exist
        const names = playerNames(college ? [] : rows, read.names);
        return { ...controls, units, labels: unitLabels(units, names, playerPages(rows, college ? read.pairs ?? [] : undefined)) };
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} ${unit}-man lineups for team ${teamId}: ${e}, ${e?.stack}`);
        return { ...controls, units: null, labels: [] };
    }
}

/** The Situations section (BB-G25): ?situation=, the three situational reads, the players' and units' names; `reads` null when a read failed. */
async function readSituations(Astro: AstroGlobal, league: BasketballLeague, season: number, teamId: number, rows: SeasonPlayerRow[]): Promise<SituationsTab> {
    const options = situationsFor(league, season);
    const situation = parseSituation(Astro.url.searchParams.get('situation'), options);
    try {
        const reads = await retrieveSituational(league, season, teamId, situation.family, situation.split);
        // the season rows are ESPN-keyed in college: never mix them with the units' and players' stats.ncaa.org ids
        const names = playerNames(isNcaaDashboards(league) ? [] : rows, reads.names);
        return { situation, options, reads, playerNames: nameRows(reads.players, names), unitLabels: unitLabels(reads.units, names) };
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} ${situation.key} situational splits for team ${teamId}: ${e}, ${e?.stack}`);
        return { situation, options, reads: null, playerNames: [], unitLabels: [] };
    }
}
