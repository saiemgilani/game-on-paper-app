/**
 * The Data API reads behind points over expected (BB-G15, behind 'bball-poe'): sdv-db's shot quality (BB-D9, sdv-db #195),
 * `shot_quality_game` and `shot_quality_season` in the league's season schema. `nba_stats` / `wnba_stats` are keyed by the
 * stats.nba.com / stats.wnba.com ids (game, team, person; regular season only), `mbb` / `wbb` by ESPN's. Each table has a
 * `level = 'team'` row (person_id null) and one `level = 'player'` row per shooter. Every number is the producer's: the
 * pages read and format, nothing is summed or re-modelled here. A league's first season is the model's warm-up: no rows.
 */
import { retrieveRows } from './sdv';
import type { BasketballLeague } from '../utils/league';

/** The tables move with the nightly ingest (the build runs at its tail): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A day has at most 15 NBA games (30 team rows); a team-season at most ~30 shooters plus the team row. */
const DAY_LIMIT = '40';
const TEAM_LIMIT = '60';
/** A player's season rows: one per team he shot for. */
const PLAYER_LIMIT = '10';

/** One row of either table. `pts` counts field goals only: free throws are not shots in the model. */
export interface ShotQualityRow {
    season: number;
    game_id?: string;
    game_date?: string;
    team_id: number;
    team_tricode: string | null;
    /** null on the team row */
    person_id: number | null;
    level: 'team' | 'player';
    games?: number;
    attempts: number;
    makes: number;
    pts: number;
    xpts: number | null;
    /** pts - xpts */
    poe: number | null;
    /** one standard error of poe, from the make chances alone */
    poe_se: number | null;
    /** expected points per shot: shot quality */
    xpps: number | null;
    /** (makes - xmakes) / attempts: shot making */
    fg_pct_oe: number | null;
}
const SELECT = 'season,game_id,game_date,team_id,team_tricode,person_id,level,attempts,makes,pts,xpts,poe,poe_se,xpps,fg_pct_oe';
const SEASON_SELECT = 'season,team_id,team_tricode,person_id,level,games,attempts,makes,pts,xpts,poe,poe_se,xpps,fg_pct_oe';

/**
 * The team rows of one game. College: by ESPN's game id. NBA/WNBA: the shot tables carry the stats game id, which the ESPN
 * game page does not know, so the read is the game's day (`date` in the league's scoreboard zone, as stats.nba.com dates
 * its games) and the page picks its two teams (utils/shotQuality.ts gameTeams).
 */
export function retrieveGameShotQuality(league: BasketballLeague, season: number, by: { gameId: string } | { date: string }): Promise<ShotQualityRow[]> {
    const key: Record<string, string> = 'gameId' in by ? { game_id: by.gameId } : { game_date: by.date };
    return retrieveRows<ShotQualityRow>(league, 'shot_quality_game', { season: String(season), ...key, level: 'team', select: SELECT, limit: DAY_LIMIT }, TTL, true);
}

/** The team row and every shooter's row of one team-season (`teamId`: the season tables' key). */
export function retrieveTeamShotQuality(league: BasketballLeague, season: number, teamId: number): Promise<ShotQualityRow[]> {
    return retrieveRows<ShotQualityRow>(league, 'shot_quality_season', { season: String(season), team_id: String(teamId), select: SEASON_SELECT, limit: TEAM_LIMIT }, TTL, true);
}

/** A player's season rows, one per team. */
export function retrievePlayerShotQuality(league: BasketballLeague, season: number, personId: number): Promise<ShotQualityRow[]> {
    return retrieveRows<ShotQualityRow>(league, 'shot_quality_season', { season: String(season), level: 'player', person_id: String(personId), select: SEASON_SELECT, limit: PLAYER_LIMIT }, TTL, true);
}
