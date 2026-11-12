/**
 * BB-G52's Data API reads: a team's season of `shot_lineups` for one side (~7,000 NBA rows, ~1.3 MB, one request under the
 * cap; no OR across the five player columns server-side, so the ON/OFF filter runs in the route), and for college the
 * stats.ncaa.org -> ESPN player crosswalk the lineup ids need for names.
 */
import { isNcaaDashboards } from '../basketball/dashboards';
import type { LineupShotRow, LineupSide } from '../nba/lineupShots';
import type { BasketballLeague } from '../utils/league';
import { read, regularOnly, SUBJECT_TTL } from './nbaShots';

const LIMIT = '50000';
const five = (p: string) => [1, 2, 3, 4, 5].map((i) => `${p}${i}`);

/** The side's regular-season shots: offense keys `team_id` and its five, defense `opp_team_id` and the defending five. */
export function retrieveLineupShotRows(season: number, teamId: number, side: LineupSide, league: BasketballLeague): Promise<LineupShotRow[]> {
    const key = side === 'offense' ? 'team_id' : 'opp_team_id';
    const select = ['game_id', 'x_legacy', 'y_legacy', 'shot_value', 'made', ...five(side === 'offense' ? 'off_player_' : 'def_player_')].join(',');
    return read<LineupShotRow>(league, 'shot_lineups', { season: String(season), [key]: String(teamId), ...regularOnly(league), select, limit: LIMIT }, SUBJECT_TTL, true);
}

/** College only: the team's stats.ncaa.org player ids -> ESPN athlete ids for the season, as text (the pros need none: []). */
export async function retrieveLineupCrosswalk(season: number, teamId: number, league: BasketballLeague): Promise<[string, string][]> {
    if (!isNcaaDashboards(league)) return [];
    const rows = await read<{ ncaa_player_id: string | number; espn_athlete_id: string | number }>(league, 'ncaa_player_crosswalk', {
        season: String(season), espn_team_id: String(teamId), select: 'ncaa_player_id,espn_athlete_id', limit: LIMIT,
    }, SUBJECT_TTL, true);
    return rows.map((r) => [String(r.ncaa_player_id), String(r.espn_athlete_id)]);
}
