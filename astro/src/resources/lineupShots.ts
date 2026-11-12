/**
 * BB-G52's Data API reads: a team's season of `shot_lineups` for one side (~7,000 NBA rows, ~1.3 MB, one request under the
 * cap; no OR across the five player columns server-side, so the ON/OFF filter runs in the route), and for college the
 * stats.ncaa.org -> ESPN player crosswalk the lineup ids need for names. Both are bounded by READ_TIMEOUT_MS: the section
 * is decorative, so a slow upstream becomes its error note instead of holding the team page.
 */
import { isNcaaDashboards } from '../basketball/dashboards';
import type { LineupShotRow, LineupSide } from '../nba/lineupShots';
import { leagueSource, type BasketballLeague } from '../utils/league';
import { regularOnly, SUBJECT_TTL } from './nbaShots';
import { retrieveRowsFrom } from './sdv';

const LIMIT = '50000';
export const READ_TIMEOUT_MS = 8000;
const five = (p: string) => [1, 2, 3, 4, 5].map((i) => `${p}${i}`);

/** A strict, timed read; a page at the cap is truncated data behind a 200, so it fails loud like nbaShots' reads. */
async function read<T>(league: BasketballLeague, table: string, query: Record<string, string>): Promise<T[]> {
    const rows = await retrieveRowsFrom<T>(leagueSource(league), table, { ...query, limit: LIMIT }, SUBJECT_TTL, true, READ_TIMEOUT_MS);
    if (rows.length >= Number(LIMIT)) throw new Error(`${table} reached the ${LIMIT}-row cap: the read is truncated`);
    return rows;
}

/**
 * The side's shots: offense keys `team_id` and its five, defense `opp_team_id` and the defending five. The pros' regular
 * season only (the game_id prefix); college every game, the same scope as the team page's dashboard.
 */
export function retrieveLineupShotRows(season: number, teamId: number, side: LineupSide, league: BasketballLeague): Promise<LineupShotRow[]> {
    const key = side === 'offense' ? 'team_id' : 'opp_team_id';
    const select = ['game_id', 'x_legacy', 'y_legacy', 'shot_value', 'made', ...five(side === 'offense' ? 'off_player_' : 'def_player_')].join(',');
    return read<LineupShotRow>(league, 'shot_lineups', { season: String(season), [key]: String(teamId), ...regularOnly(league), select });
}

/** College only: the team's stats.ncaa.org player ids -> ESPN athlete ids for the season, as text (the pros need none: []). */
export async function retrieveLineupCrosswalk(season: number, teamId: number, league: BasketballLeague): Promise<[string, string][]> {
    if (!isNcaaDashboards(league)) return [];
    const rows = await read<{ ncaa_player_id: string | number; espn_athlete_id: string | number }>(league, 'ncaa_player_crosswalk', {
        season: String(season), espn_team_id: String(teamId), select: 'ncaa_player_id,espn_athlete_id',
    });
    return rows.map((r) => [String(r.ncaa_player_id), String(r.espn_athlete_id)]);
}
