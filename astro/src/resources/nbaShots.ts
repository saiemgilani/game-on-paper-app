/**
 * The Data API reads behind the /nba dashboards (spec §3.1-3.2). Per-subject reads are raw
 * `nba_stats.shots` rows; league-wide numbers come from the three derived tables sdv-db
 * rebuilds nightly. Every read goes through `requestSDV` (KV-cached, stamp-keyed) with
 * `strict`, so a route can tell an outage (503) from an empty table (404).
 */
import { retrieveRows } from './sdv';

/** League-wide rows are good for the ingest cadence; a subject's rows follow the football player page. */
export const SEASON_TTL = 6 * 60 * 60;
export const SUBJECT_TTL = 60 * 60;
/** The API's cap; every season-level read asks for it so no row is silently dropped. */
const LIMIT = '50000';

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

export function retrieveLeagueContextRows(season: number): Promise<LeagueContextRow[]> {
    return retrieveRows<LeagueContextRow>('nba', 'shot_league_context', { season: String(season), limit: LIMIT }, SEASON_TTL, true);
}

export function retrieveSeasonPlayerRows(season: number): Promise<SeasonPlayerRow[]> {
    return retrieveRows<SeasonPlayerRow>('nba', 'shot_season_players', { season: String(season), limit: LIMIT }, SEASON_TTL, true);
}

/** Regular season only (game_id prefix 002), the lite columns only. */
export function retrievePlayerShots(season: number, personId: number): Promise<ShotApiRow[]> {
    return retrieveRows<ShotApiRow>('nba', 'shots', {
        season: String(season), person_id: String(personId), game_id__like: '002%',
        select: 'game_id,x_legacy,y_legacy,shot_distance,shot_value,shot_result', limit: LIMIT,
    }, SUBJECT_TTL, true);
}

export function retrievePlayerGameRows(season: number, personId: number): Promise<PlayerGameRow[]> {
    return retrieveRows<PlayerGameRow>('nba', 'shot_player_games', { season: String(season), person_id: String(personId), limit: LIMIT }, SUBJECT_TTL, true);
}

/** Every season he took a regular-season shot in, ascending (the season picker). */
export async function retrievePlayerSeasons(personId: number): Promise<number[]> {
    const rows = await retrieveRows<{ season: number }>('nba', 'shot_season_players', { person_id: String(personId), select: 'season', limit: LIMIT }, SEASON_TTL, true);
    return [...new Set(rows.map((r) => Number(r.season)))].sort((a, b) => a - b);
}
