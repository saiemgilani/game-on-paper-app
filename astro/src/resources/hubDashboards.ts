/**
 * The Data API reads behind the league hub's dashboards (BB-G49, behind 'bball-hub-dashboards'): the season's WAR leaders from
 * `player_war` (the league's stats schema: nba_stats / wnba_stats, the college games schemas) and the season's schedule for
 * "follow a team". Lenient like the hub's other reads: a failed read is a section left out, never a hub that does not render.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { FollowScheduleRow, WarRow } from '../basketball/hub';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** Nightly tables; the cache key also carries the table's ingest stamp, so a new ingest is a new read. */
const TTL = 6 * 60 * 60;
export const WAR_BOARD_SIZE = 25;

export function retrieveWarLeaders(league: BasketballLeague, season: number): Promise<WarRow[]> {
    return retrieveRowsFrom<WarRow>(leagueSource(league), 'player_war',
        { season: String(season), select: 'player_id,player_name,team_id,war,min', order: '-war', limit: String(WAR_BOARD_SIZE) }, TTL, false, NBA_READ_TIMEOUT_MS)
        .catch(() => []);
}

const SCHEDULE = 'game_id,game_date,season_type,type_abbreviation,status_type_name,status_type_completed,home_id,away_id,home_abbreviation,away_abbreviation,home_score,away_score';
// ponytail: the whole season's schedule (1,300 pro rows, 6,300 college rows) on every hub render that misses the cache, to
// serve one browser-chosen team; a per-team summary table on the Data API if the read shows up in render time.
export function retrieveFollowSchedule(league: BasketballLeague, season: number): Promise<FollowScheduleRow[]> {
    const cols = BASKETBALL[league].currentMembers ? `${SCHEDULE},home_current_rank,away_current_rank` : SCHEDULE; // the pro tables have no poll
    return retrieveRowsFrom<FollowScheduleRow>(BASKETBALL[league].gamesSource, 'schedule', { season: String(season), select: cols, limit: '50000' }, TTL, false, NBA_READ_TIMEOUT_MS)
        .catch(() => []);
}
