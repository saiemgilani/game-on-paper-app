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
import type { LineupShotsView } from '../../nba/lineupShots';
import { retrieveLineups } from '../../resources/lineups';
import { retrieveConferenceRows, retrieveLeagueContextRows, retrieveScheduleTeamRows, retrieveSeasonPlayerRows, retrieveTeamShots, type SeasonPlayerRow } from '../../resources/nbaShots';
import { retrieveBioNames, retrieveOnOff } from '../../resources/onOff';
import { retrieveTeamPlayStyle } from '../../resources/playStyles';
import { retrieveTeamShotQuality, type ShotQualityRow } from '../../resources/shotQuality';
import { retrieveSituational } from '../../resources/situational';
import { retrieveTeamShotZones, type TeamZoneReads } from '../../resources/shotZones';
import { retrieveGameSetCounts, retrieveTeamSeason, type GameSetCountReads, type TeamSeasonReads } from '../../resources/teamSeason';
import { retrieveTeamGameFlow, type FlowRow } from '../../resources/bballGameLogs';
import { retrieveScheduleContext, type ScheduleContextReads } from '../../resources/bballScheduleContext';
import { scheduleRows } from '../../utils/teamSeason';
import { bbGameSetOf, isSummedSet, type BbGameSet } from '../../utils/bballGameSet';
import { retrieveConferenceRows, retrieveLeagueContextRows, retrieveScheduleTeamRows, retrieveSeasonPlayerRows, retrieveTeamShots } from '../../resources/nbaShots';
import { retrieveTeamSeason, type TeamSeasonReads } from '../../resources/teamSeason';
import { retrieveTeamRankRows } from '../../resources/bballNeighbors';
import { bballTeamNeighborLists } from '../../utils/bballNeighbors';
import type { NeighborList } from '../../utils/neighbors';
import { isFeatureEnabled } from '../../utils/features';
import { parseBasis, parseGate, parseLineupSort, parseUnit, playerNames, playerPages, sortUnits, unitLabels, type LineupsTab } from '../../utils/lineups';
import { parseWowy, wowyLines, type OnOffTab } from '../../utils/onOff';
import { nameRows, parseSituation, situationsFor, type SituationsTab } from '../../utils/situations';
import type { BasketballLeague } from '../../utils/league';
import { teamPlayStyles, type PlayStyleChip } from '../../utils/playStyles';
import { playerCache, setCache, uncacheable } from './cache';
import { readLineupShots } from './lineupShots';
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
    /** BB-G52, only with 'bball-lineup-shotchart' on: the lineup ON/OFF shot chart */
    lineupShots?: LineupShotsView;
    /** BB-G5, only with 'bball-team-season' on: the season block's reads; null when one failed (the block says so) */
    seasonBlock?: TeamSeasonReads | null;
    /** BB-G3, only with 'bball-lineups' on: the Lineups tab's controls and units; `units` null when a read failed */
    lineups?: LineupsTab;
    /** BB-G4, only with 'bball-on-off' on: the On/Off and WOWY section; `players` null when a read failed */
    onOff?: OnOffTab;
    /** BB-G25, only with 'bball-situational' on: the Situations section's control and rows; `reads` null when a read failed */
    situations?: SituationsTab;
    /** BB-G15, only with 'bball-poe' on: the team-season's shot quality rows (team and shooters); null when the read failed */
    poe?: ShotQualityRow[] | null;
    /** BB-G17, only with 'bball-play-styles' on, NBA only: the team's defensive play-style chip; null when the read failed */
    playStyles?: PlayStyleChip[] | null;
    /** BB-G51, only with 'bball-shot-profile' on: the team_shot_zones row and its season FGM/FTM (team_season_stats); null when a read failed */
    shotZones?: TeamZoneReads | null;
    /** BB-G14, only with 'bball-game-set' on too: the `?games=` set the block's game-set line shows */
    gameSet?: BbGameSet;
    /** BB-G14, a summed set only: its per-game possessions reads; null when one failed (the line says so) */
    gameSetCounts?: GameSetCountReads | null;
    /** BB-G50, only with 'bball-game-logs' on too: each game's game_flow row by ESPN game id; null when that read failed */
    teamFlow?: Map<string, FlowRow> | null;
    /** BB-G53, only with 'bball-schedule-context' on too: the lines, opponent strength and player box; each null when its read failed */
    scheduleContext?: ScheduleContextReads;
    /** BB-G12, only with 'bball-rank-neighbors' on: the nearby-rank lists; null when the read failed (the section says so) */
    neighbors?: NeighborList[] | null;
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
    const onOffOn = isFeatureEnabled('bball-on-off', Astro.locals);
    const situationsOn = isFeatureEnabled('bball-situational', Astro.locals);
    const poeOn = isFeatureEnabled('bball-poe', Astro.locals); // BB-G15
    const stylesOn = isFeatureEnabled('bball-play-styles', Astro.locals) && league === 'nba'; // BB-G17: only the NBA has team styles
    const zonesOn = isFeatureEnabled('bball-shot-profile', Astro.locals); // BB-G51
    const nearby = isFeatureEnabled('bball-rank-neighbors', Astro.locals); // BB-G12, started with the block's reads
    const neighborsP = nearby ? readTeamNeighbors(league, season, teamId, resolved.q) : undefined;
    const [seasonBlock, lineups, onOff, situations, poe, shotZones, playStyles] = await Promise.all([
        flagged ? readSeasonBlock(league, season, teamId) : undefined,
        lineupsOn ? readLineups(Astro, league, season, teamId, rows) : undefined,
        onOffOn ? readOnOff(Astro, league, season, teamId, rows) : undefined,
        situationsOn ? readSituations(Astro, league, season, teamId, rows) : undefined,
        poeOn ? readTeamPoe(league, season, teamId) : undefined,
        zonesOn ? readTeamShotZones(league, season, teamId) : undefined,
        stylesOn ? readTeamPlayStyles(season, teamId) : undefined,
    ]);
    // the block and the tabs are decorative: a failed read renders the rest of the page, never cached
    if (seasonBlock === null || lineups?.units === null || onOff?.players === null || situations?.reads === null || poe === null || shotZones === null || playStyles === null) uncacheable(Astro);
    const neighbors = await neighborsP;
    if (neighbors === null) uncacheable(Astro);
    // BB-G14 rides on the block's reads; a summed set (wins, losses, last N, conference) adds the per-game possessions reads. Off,
    // ?games= is never read
    const gameSet = flagged && isFeatureEnabled('bball-game-set', Astro.locals) ? bbGameSetOf(Astro.url.searchParams.get('games')) : undefined;
    const gameSetCounts = gameSet && seasonBlock && isSummedSet(gameSet) ? await readGameSetCounts(league, season, teamId, gameSet === 'conference') : undefined;
    if (gameSetCounts === null) uncacheable(Astro);
    // BB-G50 rides on the block's schedule and rates, plus one game_flow read; off, nothing more is read
    const teamFlow = seasonBlock && isFeatureEnabled('bball-game-logs', Astro.locals) ? await readTeamFlow(league, season, teamId, seasonBlock) : undefined;
    if (teamFlow === null) uncacheable(Astro);
    // BB-G53 rides on the block's schedule: four more reads, each settling on its own (a failed one leaves its columns out
    // and the page uncached); no schedule, or off, and nothing more is read
    const scheduleContext = seasonBlock && seasonBlock.games.length > 0 && isFeatureEnabled('bball-schedule-context', Astro.locals)
        ? await retrieveScheduleContext(league, season, espnIdOf(league, season, teamId)) : undefined;
    if (scheduleContext && (!scheduleContext.lines || !scheduleContext.strength || !scheduleContext.box || !scheduleContext.proj)) uncacheable(Astro);
    const block = { ...(flagged ? { seasonBlock, ...(gameSet ? { gameSet } : {}), ...(gameSetCounts !== undefined ? { gameSetCounts } : {}), ...(teamFlow !== undefined ? { teamFlow } : {}), ...(scheduleContext ? { scheduleContext } : {}) } : {}), ...(lineupsOn ? { lineups } : {}), ...(onOffOn ? { onOff } : {}), ...(situationsOn ? { situations } : {}), ...(poeOn ? { poe } : {}), ...(zonesOn ? { shotZones } : {}), ...(stylesOn ? { playStyles } : {}), ...(nearby ? { neighbors } : {}) };
    // the picker lists only the franchise's seasons (Golden State: 2025-2026), so no option is a 404; the NBA's: all of them;
    // college: the team's member seasons (R-P11), already filtered from resolved.seasons
    const members = memberSeasonsOf(league, teamId, season, resolved.seasons);
    const own = members ? undefined : BASKETBALL[league].teams.seasonsOf(teamId, season);
    const seasons = members ?? (own ? resolved.seasons.filter((s) => own.includes(s)) : resolved.seasons);
    if (!hasShots) {
        return { ...resolved, seasons, team: member, line: shootingLine([]), roster: [], dashboard: null, sort, dir, mode, empty: true as const, coverage: coverage ?? null, ...block };
    }
    // BB-G52: read only with the flag on and only once the page will render; a failed read renders the rest, never cached
    const lineupShots = isFeatureEnabled('bball-lineup-shotchart', Astro.locals) ? await readLineupShots(Astro, league, season, teamId, rows, contextR.value) : undefined;
    if (lineupShots?.status === 'error') uncacheable(Astro);
    return {
        ...(lineupShots ? { lineupShots } : {}),
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

/** BB-G12's lists from the season's one team_strength read; null when it failed. */
async function readTeamNeighbors(league: BasketballLeague, season: number, teamId: number, q: string): Promise<NeighborList[] | null> {
    try {
        return bballTeamNeighborLists(await retrieveTeamRankRows(league, season), teamId, league, season, q);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} nearby ranks for team ${teamId}: ${e}, ${e?.stack}`);
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

/**
 * The On/Off and WOWY section (BB-G4): the two reads, ?wowy= and that player's pairs, ?onoff=all, the names; `players`
 * null when a read failed. A pro with no season row (no shot attempt) is named by one player_bio read, made only then.
 */
async function readOnOff(Astro: AstroGlobal, league: BasketballLeague, season: number, teamId: number, rows: SeasonPlayerRow[]): Promise<OnOffTab> {
    const all = Astro.url.searchParams.get('onoff') === 'all';
    try {
        const read = await retrieveOnOff(league, season, teamId);
        const wowy = parseWowy(Astro.url.searchParams.get('wowy'), read.players);
        const college = isNcaaDashboards(league);
        // the season rows are ESPN-keyed in college: never mix them with the stats.ncaa.org ids
        const names = playerNames(college ? [] : rows, read.names);
        const missing = read.players.map((p) => String(p.player_id)).filter((id) => !names.has(id));
        if (!college && missing.length) {
            // decorative: a failed name read leaves the #<id> stand-ins, never the section
            const bio = await retrieveBioNames(league, season).catch((e) => (console.error(`ERROR while naming the ${league} ${season} on/off ids ${missing.join(',')}: ${e}`), []));
            for (const r of bio) if (r.player_name && missing.includes(String(r.player_id))) names.set(String(r.player_id), r.player_name);
        }
        return { players: read.players, names, wowy, lines: wowyLines(read.pairs, wowy), all };
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} on/off for team ${teamId}: ${e}, ${e?.stack}`);
        return { players: null, names: new Map(), wowy: null, lines: [], all };
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

/** BB-G17's read (the stats.nba.com team id, the page's) as the defensive chip; null when it failed. */
async function readTeamPlayStyles(season: number, teamId: number): Promise<PlayStyleChip[] | null> {
    try {
        return teamPlayStyles(await retrieveTeamPlayStyle(season, teamId));
    } catch (e: any) {
        console.error(`ERROR while loading the nba ${season} play style for team ${teamId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** BB-G15's read, keyed like the season tables (the stats id for the NBA/WNBA, ESPN's in college); null when it failed. */
async function readTeamPoe(league: BasketballLeague, season: number, teamId: number): Promise<ShotQualityRow[] | null> {
    try {
        return await retrieveTeamShotQuality(league, season, teamId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} shot quality for team ${teamId}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** BB-G51's reads, keyed like the season tables (the stats id for the NBA/WNBA, ESPN's in college); null when one failed. */
async function readTeamShotZones(league: BasketballLeague, season: number, teamId: number): Promise<TeamZoneReads | null> {
    try {
        return await retrieveTeamShotZones(league, season, teamId);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} shot zones for team ${teamId}: ${e}, ${e?.stack}`);
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
