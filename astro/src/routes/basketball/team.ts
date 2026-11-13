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
import { retrieveGameSetCounts, retrieveTeamSeason, type GameSetCountReads, type TeamSeasonReads } from '../../resources/teamSeason';
import { retrieveTeamGameFlow, type FlowRow } from '../../resources/bballGameLogs';
import { retrieveScheduleContext, type ScheduleContextReads } from '../../resources/bballScheduleContext';
import { scheduleRows } from '../../utils/teamSeason';
import { bbGameSetOf, isSummedSet, type BbGameSet } from '../../utils/bballGameSet';
import { isFeatureEnabled } from '../../utils/features';
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
    /** BB-G14, only with 'bball-game-set' on too: the `?games=` set the block's game-set line shows */
    gameSet?: BbGameSet;
    /** BB-G14, a summed set only: its per-game possessions reads; null when one failed (the line says so) */
    gameSetCounts?: GameSetCountReads | null;
    /** BB-G50, only with 'bball-game-logs' on too: each game's game_flow row by ESPN game id; null when that read failed */
    teamFlow?: Map<string, FlowRow> | null;
    /** BB-G53, only with 'bball-schedule-context' on too: the lines, opponent strength and player box; each null when its read failed */
    scheduleContext?: ScheduleContextReads;
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
    // BB-G14 rides on the block's reads; a summed set (wins, losses, last N, conference) adds the per-game possessions reads. Off,
    // ?games= is never read
    const gameSetOn = flagged && isFeatureEnabled('bball-game-set', Astro.locals);
    const seasonBlock = flagged ? await readSeasonBlock(league, season, teamId) : undefined;
    // the block is decorative: a failed read renders the rest of the page, never cached
    if (seasonBlock === null) uncacheable(Astro);
    const gameSet = gameSetOn ? bbGameSetOf(Astro.url.searchParams.get('games')) : undefined;
    const gameSetCounts = gameSet && seasonBlock && isSummedSet(gameSet) ? await readGameSetCounts(league, season, teamId, gameSet === 'conference') : undefined;
    if (gameSetCounts === null) uncacheable(Astro);
    // BB-G50 rides on the block's schedule and rates, plus one game_flow read; off, nothing more is read
    const teamFlow = seasonBlock && isFeatureEnabled('bball-game-logs', Astro.locals) ? await readTeamFlow(league, season, teamId, seasonBlock) : undefined;
    if (teamFlow === null) uncacheable(Astro);
    // BB-G53 rides on the block's schedule: three more reads, each settling on its own (a failed one leaves its columns out
    // and the page uncached); no schedule, or off, and nothing more is read
    const scheduleContext = seasonBlock && seasonBlock.games.length > 0 && isFeatureEnabled('bball-schedule-context', Astro.locals)
        ? await retrieveScheduleContext(league, season, espnIdOf(league, season, teamId)) : undefined;
    if (scheduleContext && (!scheduleContext.lines || !scheduleContext.strength || !scheduleContext.box)) uncacheable(Astro);
    const block = flagged ? { seasonBlock, ...(gameSet ? { gameSet } : {}), ...(gameSetCounts !== undefined ? { gameSetCounts } : {}), ...(teamFlow !== undefined ? { teamFlow } : {}), ...(scheduleContext ? { scheduleContext } : {}) } : {};
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

const espnIdOf = (league: BasketballLeague, season: number, teamId: number) => BASKETBALL[league].teams.inSeason(teamId, season)?.espn_id ?? (BASKETBALL[league].currentMembers ? teamId : 0);

/** The team game log's game_flow rows (BB-G50); null when the read failed (the log leaves its flow columns out). */
async function readTeamFlow(league: BasketballLeague, season: number, teamId: number, block: TeamSeasonReads): Promise<Map<string, FlowRow> | null> {
    const espnId = espnIdOf(league, season, teamId);
    try {
        return await retrieveTeamGameFlow(league, season, teamId, espnId, scheduleRows(block.games, block.gameRates, espnId));
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} game flow for team ${teamId}: ${e}`);
        return null;
    }
}

/** The season block's reads (BB-G5); null when any failed. The NBA/WNBA season tables are keyed by the stats id, the games by ESPN's. */
async function readSeasonBlock(league: BasketballLeague, season: number, teamId: number): Promise<TeamSeasonReads | null> {
    const espnId = espnIdOf(league, season, teamId);
    try {
        if (!espnId) throw new Error('no ESPN id for the team-season');
        return await retrieveTeamSeason(league, season, teamId, espnId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} season block for team ${teamId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** BB-G14's summed-set reads (the per-game possessions rows and their game-id map); null when any failed (the line says so). */
async function readGameSetCounts(league: BasketballLeague, season: number, teamId: number, conference: boolean): Promise<GameSetCountReads | null> {
    try {
        return await retrieveGameSetCounts(league, season, teamId, espnIdOf(league, season, teamId), conference);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} game-set counts for team ${teamId}: ${e}, ${e?.stack}`);
        return null;
    }
}
