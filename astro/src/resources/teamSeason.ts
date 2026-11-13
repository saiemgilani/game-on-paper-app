/**
 * The Data API reads behind the team page's season block (BB-G5, behind 'bball-team-season'): sdv-db's season team
 * rates (BB-D3, sdv-db #185) and team strength (BB-D19) in the league's season schema (`nba_stats` / `wnba_stats`,
 * keyed by the stats.nba.com / stats.wnba.com team id; `mbb` / `wbb`, keyed by the ESPN id), plus the team's ESPN
 * schedule and per-game rates (`game_team_rates`) from the league's games schema, keyed by the ESPN id. Every rate,
 * rank and percentile is the producer's (sdv-py *_team_season_rates / *_team_strength / the game pages); the block
 * reads, orders and formats. Reads are strict, so an outage is never shown as a team with no games.
 */
import { retrieveRows, retrieveRowsFrom } from './sdv';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, type BasketballLeague } from '../utils/league';

/** The season products move once a day (16:00 UTC), the games with the nightly ingest: the season pages' window. */
const TTL = 6 * 60 * 60;
/** A team-season is 5 split rows and at most ~45 home or away games (college); the caps keep a bad filter from paging silently. */
const SPLIT_LIMIT = '10';
const GAME_LIMIT = '200';

export const SPLITS = ['all', 'home', 'away', 'close', 'clutch'] as const;
export type Split = (typeof SPLITS)[number];

/** The rated metrics of one split row; each has `<m>_rank` (1 = best), `<m>_pct` (0-100, higher = better) and `<m>_n`. */
export const RATED = ['off_rtg', 'def_rtg', 'net_rtg', 'pace', 'efg_pct', 'tov_pct', 'orb_pct', 'ft_rate', 'opp_efg_pct', 'opp_tov_pct', 'opp_orb_pct', 'opp_ft_rate'] as const;
export type Rated = (typeof RATED)[number];

export type TeamSeasonRateRow = {
    season: number;
    team_id: number;
    split: Split;
    games: number;
    poss: number;
    opp_poss: number;
    pts: number;
    opp_pts: number;
} & { [K in Rated]: number | null } & { [K in `${Rated}_rank` | `${Rated}_pct`]: number | null };

export interface TeamStrengthRow {
    wins: number | null;
    losses: number | null;
    adj_off_rtg: number | null;
    adj_def_rtg: number | null;
    adj_net_rtg: number | null;
    adj_off_rtg_rank: number | null;
    adj_def_rtg_rank: number | null;
    adj_net_rtg_rank: number | null;
    adj_off_rtg_pct: number | null;
    adj_def_rtg_pct: number | null;
    adj_net_rtg_pct: number | null;
}
const STRENGTH_SELECT = 'wins,losses,adj_off_rtg,adj_def_rtg,adj_net_rtg,adj_off_rtg_rank,adj_def_rtg_rank,adj_net_rtg_rank,adj_off_rtg_pct,adj_def_rtg_pct,adj_net_rtg_pct';

/** One ESPN schedule row of the team's regular season. */
export interface ScheduleGameRow {
    id: number | string;
    date: string;
    status_type_completed: boolean | string | null;
    neutral_site: boolean | string | null;
    home_id: number | string;
    away_id: number | string;
    home_abbreviation: string | null;
    away_abbreviation: string | null;
    home_display_name: string | null;
    away_display_name: string | null;
    home_score: number | string | null;
    away_score: number | string | null;
}
const SCHEDULE_SELECT = 'id,date,status_type_completed,neutral_site,home_id,away_id,home_abbreviation,away_abbreviation,home_display_name,away_display_name,home_score,away_score';

/** One team's rates in one game (the game page's four factors). */
export interface GameRateRow {
    game_id: number | string;
    off_rtg: number | null;
    def_rtg: number | null;
    pace: number | null;
    efg_pct: number | null;
    tov_pct: number | null;
    orb_pct: number | null;
    ft_rate: number | null;
}
const GAME_RATE_SELECT = 'game_id,off_rtg,def_rtg,pace,efg_pct,tov_pct,orb_pct,ft_rate';

export interface TeamSeasonReads {
    rates: TeamSeasonRateRow[];
    /** null: the producer has no row for the team-season */
    strength: TeamStrengthRow | null;
    games: ScheduleGameRow[];
    gameRates: GameRateRow[];
}

/** The four reads, in parallel, strict. `teamId` keys the season tables; `espnId` the games (the same id in college). */
export async function retrieveTeamSeason(league: BasketballLeague, season: number, teamId: number, espnId: number): Promise<TeamSeasonReads> {
    const s = String(season);
    const games = BASKETBALL[league].gamesSource;
    // the rates' scope: the NBA/WNBA regular season (ESPN season_type 2; sdv-py nba_team_season_rates season_type="regular-season"),
    // every college game (sdv-py mbb_team_season_rates / mbb_team_strength read all of ESPN's games, the tournaments included)
    const scope: Record<string, string> = PRO_LEAGUES.includes(league) ? { season_type: '2' } : {};
    const side = (key: 'home_id' | 'away_id') =>
        retrieveRowsFrom<ScheduleGameRow>(games, 'schedule', { season: s, ...scope, [key]: String(espnId), select: SCHEDULE_SELECT, limit: GAME_LIMIT }, TTL, true);
    const [rates, strength, home, away, gameRates] = await Promise.all([
        retrieveRows<TeamSeasonRateRow>(league, 'team_season_rates', { season: s, team_id: String(teamId), limit: SPLIT_LIMIT }, TTL, true),
        retrieveRows<TeamStrengthRow>(league, 'team_strength', { season: s, team_id: String(teamId), select: STRENGTH_SELECT, limit: '1' }, TTL, true),
        side('home_id'),
        side('away_id'),
        retrieveRowsFrom<GameRateRow>(games, 'game_team_rates', { season: s, team_id: String(espnId), select: GAME_RATE_SELECT, limit: GAME_LIMIT }, TTL, true),
    ]);
    return { rates, strength: strength[0] ?? null, games: [...home, ...away], gameRates };
}

/** One team-game's play-by-play totals (sdv-db team_game_possessions, split 'all'), the columns BB-G14's summed sets add. */
export interface TeamGamePossRow {
    game_id: number | string;
    poss: number | null;
    opp_poss: number | null;
    pts: number | null;
    opp_pts: number | null;
    seconds: number | null;
}
const POSS_SELECT = 'game_id,poss,opp_poss,pts,opp_pts,seconds';
/** One row per regular-season team-game (82 for an NBA team); the cap keeps a bad filter from paging silently. */
const POSS_LIMIT = '100';

export interface GameSetCountReads {
    /** the team's per-game possessions rows, keyed by the producer's game id */
    games: TeamGamePossRow[];
    /** producer game id -> ESPN game id (the schedule's) */
    espnOf: Map<string, string>;
    /** college, `conference` asked: the ESPN ids of the team's conference games; null otherwise */
    conference: Set<string> | null;
}

/**
 * BB-G14 ('bball-game-set'), only for a summed set (wins, losses, last N, conference): the team's per-game possessions rows
 * (team_game_possessions, the play-by-play count the All / Home / Away split rows add up) and the map from their game ids
 * to ESPN's. The pros' ids map through
 * the games schema's schedule_crosswalk (both sides), college's through ncaa_team_box (contest id -> ESPN game id).
 * `conference` (college) adds the schedule's conference_competition flags. Strict, in parallel.
 */
export async function retrieveGameSetCounts(league: BasketballLeague, season: number, teamId: number, espnId: number, conference: boolean): Promise<GameSetCountReads> {
    const s = String(season);
    const src = BASKETBALL[league].gamesSource;
    const pro = PRO_LEAGUES.includes(league);
    const games = retrieveRows<TeamGamePossRow>(league, 'team_game_possessions', { season: s, team_id: String(teamId), split: 'all', select: POSS_SELECT, limit: POSS_LIMIT }, TTL, true);
    const key = `${league}_game_id`; // nba_game_id / wnba_game_id
    const crosswalk = (side: 'home' | 'away') => retrieveRowsFrom<Record<string, string | number | null>>(src, 'schedule_crosswalk', { season: s, [`${side}_espn_team_id`]: String(espnId), select: `espn_game_id,${key}`, limit: GAME_LIMIT }, TTL, true);
    const pairs: Promise<[unknown, unknown][]> = pro
        ? Promise.all([crosswalk('home'), crosswalk('away')]).then(([h, a]) => [...h, ...a].map((r) => [r[key], r.espn_game_id]))
        : retrieveRows<{ contest_id: string | number; espn_game_id: string | number }>(league, 'ncaa_team_box', { season: s, team_espn_team_id: String(espnId), select: 'contest_id,espn_game_id', limit: GAME_LIMIT }, TTL, true).then((rows) => rows.map((r) => [r.contest_id, r.espn_game_id]));
    const flags = (k: 'home_id' | 'away_id') => retrieveRowsFrom<{ id: number | string; conference_competition: boolean | string | null }>(src, 'schedule', { season: s, [k]: String(espnId), select: 'id,conference_competition', limit: GAME_LIMIT }, TTL, true);
    const conf = conference && !pro ? Promise.all([flags('home_id'), flags('away_id')]).then(([h, a]) => new Set([...h, ...a].filter((g) => g.conference_competition === true || g.conference_competition === 'true').map((g) => String(g.id)))) : Promise.resolve(null);
    const [rows, ids, confIds] = await Promise.all([games, pairs, conf]);
    return { games: rows, espnOf: new Map(ids.filter(([p, e]) => p != null && e != null).map(([p, e]) => [String(p), String(e)])), conference: confIds };
}
