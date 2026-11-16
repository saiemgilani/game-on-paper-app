/**
 * The Data API read behind the game page's garbage-time toggle (BB-G2, behind 'bball-garbage-time'): the game's
 * possession log with the producer's `is_garbage_time` flag. The pros read `{nba,wnba}_stats.possessions` by the stats
 * game id (the schedule_crosswalk read BB-G1 already makes, same query and cache entry); college reads
 * `{mbb,wbb}.ncaa_possessions` by the ESPN game id. Strict like the Impact box: an outage is never a game with no log.
 *
 * The pro read names no columns, so a release published before BB-D7's flags (hoopR-nba-stats-data #54,
 * wehoop-wnba-stats-data #28) still answers, without them; the page then shows no toggle (utils/garbageTime.ts
 * hasGarbageFlag). College's log has always carried bigballR's flag.
 *
 * The four factors' Possessions, ORtg and DRtg come from the producer's per-game splits (`situational_team_games`, BB-D21:
 * family `all` and family `garbage` split `not_garbage_time`), not from sums of the log. That table is keyed like the
 * season tables: the pros by the stats game id (the same crosswalk), college by the stats.ncaa.org contest id with ESPN
 * team ids, so the ESPN game id maps through `ncaa_team_box` first (as BB-G25's game page does).
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { retrieveProGame } from './impactBox';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** As the Impact box: the season products' window. */
const TTL = 6 * 60 * 60;
/** A game is ~200 possessions (more with overtimes); the cap keeps a bad filter from paging silently. */
const POSSESSION_LIMIT = '400';
/** A team-game is at most ~24 split rows (11 families), both teams under 60. */
const SPLIT_LIMIT = '60';
const SPLIT_SELECT = 'team_id,family,split,poss,off_rtg,def_rtg';
const NCAA_SELECT = ['period', 'poss_num', 'poss_team', 'home', 'pts', 'is_garbage_time', 'last_event_time', 'poss_team_espn_team_id', 'home_espn_team_id', 'away_espn_team_id',
    ...['home', 'away'].flatMap((s) => [1, 2, 3, 4, 5].map((i) => `${s}_${i}_player_id`))].join(',');

/** One situational_team_games row: a team's possessions and ratings in one (family, split) of the game. */
export interface GameSplitRow { team_id: number | string; family: string; split: string; poss: number | null; off_rtg: number | null; def_rtg: number | null }

export interface GarbageReads {
    /** the possession log's team id of each ESPN side (stats ids for the pros, ESPN ids in college); null when unmapped */
    teams: { home: number; away: number } | null;
    rows: Record<string, any>[];
    /** the game's situational_team_games rows, keyed by the same team ids; [] when the producer has none for the game */
    splits: GameSplitRow[];
}

/** The log and the per-game splits for one ESPN game; no teams and no rows when it is not mapped (the pros' crosswalk has no row). */
export async function retrieveGarbageTime(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<GarbageReads> {
    const read = async <T = Record<string, any>>(table: string, q: Record<string, string>, limit = POSSESSION_LIMIT) => {
        const rows = await retrieveRowsFrom<T>(leagueSource(league), table, { season: String(season), ...q, limit }, TTL, true, NBA_READ_TIMEOUT_MS);
        // a read cut at the cap would split part of the game: a failed read, never a short one
        if (rows.length >= Number(limit)) throw new Error(`${table}: ${rows.length} rows, at the ${limit} cap`);
        return rows;
    };
    const splits = (gameId: string | null) => (gameId ? read<GameSplitRow>('situational_team_games', { game_id: gameId, select: SPLIT_SELECT }, SPLIT_LIMIT) : Promise.resolve([]));
    if (PRO_LEAGUES.includes(league)) {
        const x = await retrieveProGame(league, season, espnGameId);
        if (!x) return { teams: null, rows: [], splits: [] };
        const [rows, split] = await Promise.all([read('possessions', { game_id: x.gameId }), splits(x.gameId)]);
        return { teams: x.teams, rows, splits: split };
    }
    const [rows, split] = await Promise.all([
        read('ncaa_possessions', { espn_game_id: espnGameId, select: NCAA_SELECT }),
        read<{ contest_id: string | number | null }>('ncaa_team_box', { espn_game_id: espnGameId, select: 'contest_id' }, '10')
            .then((box) => splits(box.find((r) => r.contest_id != null)?.contest_id?.toString() ?? null)),
    ]);
    return { teams: { home: homeId, away: awayId }, rows, splits: split };
}
