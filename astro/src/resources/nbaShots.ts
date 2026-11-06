/**
 * The Data API reads behind the /nba dashboards (spec §3.1-3.2). Per-subject reads are raw
 * `nba_stats.shots` rows; league-wide numbers come from the three derived tables sdv-db
 * rebuilds nightly. Every read goes through `requestSDV` (KV-cached, stamp-keyed) with
 * `strict`, so a route can tell an outage (503) from an empty table (404).
 */
import { retrieveRows } from './sdv';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';

/** League-wide rows are good for the ingest cadence; a subject's rows follow the football player page. */
export const SEASON_TTL = 6 * 60 * 60;
export const SUBJECT_TTL = 60 * 60;
/** The API's cap; every season-level read asks for it so no row is silently dropped. */
const LIMIT = '50000';

/** Regular season only: `<prefix>%` on game_id where the league's ids carry one (stats.nba.com '002'). Key order is the cache key's. */
const regularOnly = (league: BasketballLeague): Record<string, string> => {
    const p = BASKETBALL[league].regularGameIdPrefix;
    return p ? { game_id__like: `${p}%` } : {};
};

/** retrieveRows, but a page that hit the cap is truncated data behind a 200: fail loud (the routes' 503). */
async function read<T>(...args: Parameters<typeof retrieveRows>): Promise<T[]> {
    const rows = (await retrieveRows(...args)) as T[];
    if (rows.length >= Number(LIMIT)) throw new Error(`${args[1]} reached the ${LIMIT}-row cap: the read is truncated`);
    return rows;
}

export interface LeagueContextRow {
    season: number;
    kind: string;
    key1: number | null;
    key2: number | null;
    attempts: number;
    makes: number;
    fg3a: number;
    fg3m: number;
}

export interface SeasonPlayerRow {
    season: number;
    person_id: number;
    player_name: string;
    team_id: number;
    team_tricode: string;
    attempts: number;
    makes: number;
    fg3a: number;
    fg3m: number;
    ra_attempts: number;
    ra_makes: number;
    mid_attempts: number;
    mid_makes: number;
    is_primary: boolean;
    n_teams: number;
    has_stats: boolean;
    gp: number | null;
    min_pg: number | null;
    fga_total: number | null;
    fg_pct: number | null;
    efg_pct: number | null;
    ts_pct: number | null;
    usg_pct: number | null;
    pie: number | null;
    pts_pg: number | null;
    fga_pg: number | null;
    min_total: number | null;
    headshot_href: string | null;
}

export interface PlayerGameRow {
    season: number;
    person_id: number;
    game_id: string;
    team_id: number;
    team_tricode: string;
    attempts: number;
    makes: number;
    fg3a: number;
    fg3m: number;
    game_date: string | null;
    opponent_id: number | null;
    opponent: string | null;
    venue: 'home' | 'away' | 'neutral' | null;
    win: boolean | null;
}

/** The six columns the charts read (blazing's ShotLite), straight from nba_stats.shots. */
export interface ShotApiRow {
    game_id: string;
    x_legacy: number;
    y_legacy: number;
    shot_distance: number;
    shot_value: number;
    shot_result: 'Made' | 'Missed';
}

export function retrieveLeagueContextRows(season: number, league: BasketballLeague): Promise<LeagueContextRow[]> {
    return read<LeagueContextRow>(league, 'shot_league_context', { season: String(season), limit: LIMIT }, SEASON_TTL, true);
}

export function retrieveSeasonPlayerRows(season: number, league: BasketballLeague): Promise<SeasonPlayerRow[]> {
    return read<SeasonPlayerRow>(league, 'shot_season_players', { season: String(season), limit: LIMIT }, SEASON_TTL, true);
}

/** Regular season only (the league's game_id prefix, 002 for the NBA), the lite columns only. */
export function retrievePlayerShots(season: number, personId: number, league: BasketballLeague): Promise<ShotApiRow[]> {
    return read<ShotApiRow>(league, 'shots', {
        season: String(season), person_id: String(personId), ...regularOnly(league),
        select: 'game_id,x_legacy,y_legacy,shot_distance,shot_value,shot_result', limit: LIMIT,
    }, SUBJECT_TTL, true);
}

/** A team's regular-season shots, the lite columns only (the team page's dashboard and line). */
export function retrieveTeamShots(season: number, teamId: number, league: BasketballLeague): Promise<ShotApiRow[]> {
    return read<ShotApiRow>(league, 'shots', {
        season: String(season), team_id: String(teamId), ...regularOnly(league),
        select: 'game_id,x_legacy,y_legacy,shot_distance,shot_value,shot_result', limit: LIMIT,
    }, SUBJECT_TTL, true);
}

export function retrievePlayerGameRows(season: number, personId: number, league: BasketballLeague): Promise<PlayerGameRow[]> {
    return read<PlayerGameRow>(league, 'shot_player_games', { season: String(season), person_id: String(personId), limit: LIMIT }, SUBJECT_TTL, true);
}

/** Every player's game rows for the season (the leaders page's input; ~25k rows, under the cap). */
export function retrieveSeasonPlayerGameRows(season: number, league: BasketballLeague): Promise<PlayerGameRow[]> {
    return read<PlayerGameRow>(league, 'shot_player_games', { season: String(season), limit: LIMIT }, SEASON_TTL, true);
}

/** Every season he took a regular-season shot in, ascending (the season picker). */
export async function retrievePlayerSeasons(personId: number, league: BasketballLeague): Promise<number[]> {
    const rows = await read<{ season: number }>(league, 'shot_season_players', { person_id: String(personId), select: 'season', limit: LIMIT }, SEASON_TTL, true);
    return [...new Set(rows.map((r) => Number(r.season)))].sort((a, b) => a - b);
}
