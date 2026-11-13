/**
 * The Data API reads behind the team page's schedule context and rotation (BB-G53, behind 'bball-schedule-context',
 * inside 'bball-team-season'). Three reads beside the season block's, each optional:
 * - `game_lines` (BB-D33): the season's closing spread and ATS result per ESPN game. It carries no team ids, so it is one
 *   season-wide read with a fixed select, shared by every team page of the league (MBB ~5,500 rows of three columns).
 * - `team_strength` (BB-D19): every team's adjusted net rating and rank, the opponent-strength column. The pros key it by
 *   the stats.nba.com / stats.wnba.com id, mapped here to ESPN's; college is ESPN-keyed.
 * - `player_box`: the team's minutes and starts per game, the rotation strip (the pros' regular season, as the block).
 * - `rated_priors` (sdv-py's pregame projections, the game page's rated prior): each game's projected home margin, one
 *   season-wide read like the lines. Until sdv-db serves the table its 404 is "no projections yet", not a failure.
 * A failed read is null (its columns are left out) and the page is not cached.
 */
import { SDVRequestError, retrieveRowsFrom } from './sdv';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day, the games with the nightly ingest: the season pages' window. */
const TTL = 6 * 60 * 60;
/** One season's lined games: MBB 5,435 in 2025-26, the most of the four leagues. */
const LINES_LIMIT = '8000';
/** Every rated team: 365 MBB teams in 2025-26, 30 / 15 pro. */
const STRENGTH_LIMIT = '1000';
/** One team-season's player rows: ~82 games x ~15 players (NBA), with room for a long college season. */
const BOX_LIMIT = '3000';

export type AtsResult = 'home' | 'away' | 'push';
export interface LineRow { game_id: number | string; spread_home_close: number | null; ats_result: AtsResult | null }
export interface OppStrength { rating: number | null; rank: number | null }
export interface RotationBoxRow {
    game_id: number | string;
    athlete_id: number | string;
    athlete_short_name: string | null;
    minutes: number | string | null;
    starter: boolean | string | null;
    did_not_play: boolean | string | null;
}

export interface ScheduleContextReads {
    /** by ESPN game id; null: the read failed */
    lines: Map<string, LineRow> | null;
    /** by ESPN team id; null: the read failed */
    strength: Map<string, OppStrength> | null;
    /** null: the read failed */
    box: RotationBoxRow[] | null;
    /** each game's projected home margin (exp_home_margin) by ESPN game id; null: the read failed; empty before the table is served */
    proj: Map<string, number> | null;
}

const settled = <T>(r: PromiseSettledResult<T>, what: string): T | null => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`ERROR while loading the schedule context's ${what}: ${r.reason}`);
    return null;
};

export async function retrieveScheduleContext(league: BasketballLeague, season: number, espnId: number): Promise<ScheduleContextReads> {
    const s = String(season);
    const games = BASKETBALL[league].gamesSource;
    const pro = PRO_LEAGUES.includes(league);
    const [lines, strength, box, proj] = await Promise.allSettled([
        retrieveRowsFrom<LineRow>(games, 'game_lines', { season: s, select: 'game_id,spread_home_close,ats_result', limit: LINES_LIMIT }, TTL, true),
        retrieveRowsFrom<{ team_id: number | string; adj_net_rtg: number | null; adj_net_rtg_rank: number | null }>(leagueSource(league), 'team_strength',
            { season: s, select: 'team_id,adj_net_rtg,adj_net_rtg_rank', limit: STRENGTH_LIMIT }, TTL, true),
        retrieveRowsFrom<RotationBoxRow>(games, 'player_box',
            { season: s, team_id: String(espnId), ...(pro ? { season_type: '2' } : {}), select: 'game_id,athlete_id,athlete_short_name,minutes,starter,did_not_play', limit: BOX_LIMIT }, TTL, true),
        retrieveRowsFrom<{ game_id: number | string; exp_home_margin: number | null }>(games, 'rated_priors', { season: s, select: 'game_id,exp_home_margin', limit: LINES_LIMIT }, TTL, true)
            .catch((e) => { if (e instanceof SDVRequestError && e.status === 404) return []; throw e; }),
    ]);
    const projRows = settled(proj, 'projections');
    const lineRows = settled(lines, 'game lines');
    const strengthRows = settled(strength, 'team strength');
    // the pros' team_strength is keyed by the stats id: the page's games and opponents are ESPN's
    const espnOf = (id: number | string) => (pro ? BASKETBALL[league].teams.inSeason(Number(id), season)?.espn_id : Number(id));
    return {
        lines: lineRows && new Map(lineRows.map((r) => [String(r.game_id), r])),
        strength: strengthRows && new Map(strengthRows.flatMap((r) => {
            const e = espnOf(r.team_id);
            return e ? [[String(e), { rating: r.adj_net_rtg, rank: r.adj_net_rtg_rank }] as const] : [];
        })),
        box: settled(box, 'player box'),
        proj: projRows && new Map(projRows.flatMap((r) => (r.exp_home_margin == null ? [] : [[String(r.game_id), Number(r.exp_home_margin)] as const]))),
    };
}
