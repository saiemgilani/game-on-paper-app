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
