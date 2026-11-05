/**
 * The Data API reads behind BB-G28 (behind 'bball-game-flow'): sdv-db's game_flow (one row per team and game, every
 * season type for the pros) and team_season_flow (one row per team and season, with `_rank` / `_pct` / `_n`), BB-D27,
 * sdv-db #197, in the league's season schema. As the Impact box (resources/impactBox.ts): the pro tables are keyed by
 * stats.nba.com / stats.wnba.com ids, so an ESPN game is mapped through schedule_crosswalk; the college tables by the
 * stats.ncaa.org contest id with ESPN team ids, so ncaa_player_box (by the ESPN game id) gives the contest. Every
 * number is the producer's (sdv-py `_common.game_flow`); the page reads and formats. Reads are strict: an outage is
 * never shown as a game with no flow.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { retrieveProGame } from './impactBox';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** The tables are rebuilt once a day (the 16:00 UTC season products): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A pro season is 30 (NBA) or 15 (WNBA) teams; the cap keeps a bad filter from paging silently. */
const TEAM_LIMIT = '40';

/** One team's flow in one game (sdv-py nba_game_flow's columns). */
export interface GameFlowRow {
    game_id: string;
    team_id: number;
    opp_team_id: number;
    is_home: boolean;
    pts: number | null;
    opp_pts: number | null;
    game_seconds: number | null;
    lead_sec: number | null;
    trail_sec: number | null;
    tied_sec: number | null;
    lead_pct: number | null;
    lead_changes: number | null;
    times_tied: number | null;
    largest_lead: number | null;
    largest_deficit: number | null;
    comeback: number | null;
    max_run: number | null;
    runs_10: number | null;
    opp_runs_10: number | null;
    longest_drought_sec: number | null;
    avg_margin: number | null;
    avg_wp: number | null;
    def_poss: number | null;
    stops: number | null;
    kills: number | null;
    double_kills: number | null;
}
const GAME_SELECT = 'game_id,team_id,opp_team_id,is_home,pts,opp_pts,game_seconds,lead_sec,trail_sec,tied_sec,lead_pct,lead_changes,times_tied,largest_lead,largest_deficit,comeback,max_run,runs_10,opp_runs_10,longest_drought_sec,avg_margin,avg_wp,def_poss,stops,kills,double_kills';

export interface GameFlowReads {
    /** the producer's game id; null when the game is not mapped */
    gameId: string | null;
    home: GameFlowRow | null;
    away: GameFlowRow | null;
}
/** No producer rows for the game (not mapped, or not built yet). */
export const EMPTY_FLOW: GameFlowReads = { gameId: null, home: null, away: null };

/**
 * One ESPN game's two rows, strict: the id mapping, then one read of at most two rows. `homeId` / `awayId` are the ESPN
 * team ids (college keys its rows by them; the pros by the crosswalk's stats ids).
 */
export async function retrieveGameFlow(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<GameFlowReads> {
    const s = String(season);
    const src = leagueSource(league);
    let gameId: string;
    let teams: { home: number; away: number };
    if (PRO_LEAGUES.includes(league)) {
        const x = await retrieveProGame(league, season, espnGameId);
        if (!x) return EMPTY_FLOW;
        ({ gameId, teams } = x);
    } else {
        const [box] = await retrieveRowsFrom<{ contest_id: string | null }>(src, 'ncaa_player_box', { season: s, espn_game_id: espnGameId, select: 'contest_id', limit: '1' }, TTL, true, NBA_READ_TIMEOUT_MS);
        if (!box?.contest_id) return EMPTY_FLOW;
        gameId = String(box.contest_id);
        teams = { home: homeId, away: awayId };
    }
    const rows = await retrieveRowsFrom<GameFlowRow>(src, 'game_flow', { season: s, game_id: gameId, select: GAME_SELECT, limit: '2' }, TTL, true, NBA_READ_TIMEOUT_MS);
    // a non-D1 opponent has no ESPN-keyed row: that side stays null
    const of = (id: number) => rows.find((r) => Number(r.team_id) === id) ?? null;
    return { gameId, home: of(teams.home), away: of(teams.away) };
}

/** The season flow metrics the board shows, each with the producer's `_rank` and `_pct`. */
export const SEASON_FLOW_METRICS = ['avg_margin', 'avg_wp', 'lead_pct', 'runs_10_pg', 'opp_runs_10_pg', 'avg_longest_drought_sec', 'stop_pct', 'kills_pg', 'double_kills_pg', 'kills_per_100'] as const;
export type SeasonFlowMetric = (typeof SEASON_FLOW_METRICS)[number];

/** One team's season flow (sdv-py nba_team_season_flow): the values the board shows, with their ranks and percentiles. */
export type TeamSeasonFlowRow = { season: number; team_id: number; games: number; wins: number; lead_changes_pg: number | null; max_run: number | null; largest_comeback: number | null }
    & { [K in SeasonFlowMetric | `${SeasonFlowMetric}_rank` | `${SeasonFlowMetric}_pct`]: number | null }
    & { [K in `${SeasonFlowMetric}_n`]: number | null };

/** A pro season's team rows, strict (the season-filtered table is one row per team). */
export async function retrieveTeamSeasonFlow(league: 'nba' | 'wnba', season: number): Promise<TeamSeasonFlowRow[]> {
    return retrieveRowsFrom<TeamSeasonFlowRow>(leagueSource(league), 'team_season_flow', { season: String(season), limit: TEAM_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
}
