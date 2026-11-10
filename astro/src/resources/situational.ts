/**
 * The Data API read behind the player page's Situations section (BB-G55, behind 'bball-player-situations'): sdv-db's
 * situational splits (BB-D21) in the league's season schema (`nba_stats` / `wnba_stats`, keyed by the stats.nba.com /
 * stats.wnba.com player id; `mbb` / `wbb`, keyed by the ESPN team id and the stats.ncaa.org player id). One player-season
 * is one (family, split) row per team he played for; every number is the producer's (sdv-py *_situational_player).
 * College's player pages are keyed by the ESPN athlete id, so his season's stats.ncaa.org id comes from
 * `ncaa_player_crosswalk` (BB-D37) first. Strict, so an outage is never shown as a player with no possessions.
 *
 * ponytail: `SituationalRow` and its columns are the team page's (GOP#416, BB-G25, the same file); when the two stacks
 * meet, keep one copy of each and both reads.
 */
import { retrieveRowsFrom } from './sdv';
import { retrieveNcaaPlayerId } from './ncaaPlayerCrosswalk';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { isNcaaDashboards } from '../basketball/dashboards';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The situational tables are rebuilt with the season products (once a day): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A player-season is at most 25 split rows (11 families) per team; five teams fit, and a bad filter never pages silently. */
const PLAYER_LIMIT = '125';

export interface SituationalRow {
    family: string;
    split: string;
    games: number;
    minutes: number | null;
    poss: number;
    opp_poss: number;
    pts: number;
    opp_pts: number;
    plus_minus: number;
    off_rtg: number | null;
    def_rtg: number | null;
    net_rtg: number | null;
}
const COLS = 'family,split,games,minutes,poss,opp_poss,pts,opp_pts,plus_minus,off_rtg,def_rtg,net_rtg';

/** his team's id: stats.nba.com's for the pros, ESPN's in college */
export type PlayerSplitRow = SituationalRow & { team_id: number };

/**
 * Every split row of his season (one set per team), bounded by the game page's read timeout. College reads his
 * stats.ncaa.org id first; no matched pair is [] (no read), a failed crosswalk read rejects.
 */
export async function retrievePlayerSituational(league: BasketballLeague, season: number, personId: number): Promise<PlayerSplitRow[]> {
    const source = leagueSource(league);
    const id = isNcaaDashboards(league) ? await retrieveNcaaPlayerId(source, season, personId, TTL, NBA_READ_TIMEOUT_MS) : String(personId);
    if (id === null) return [];
    return retrieveRowsFrom<PlayerSplitRow>(source, 'situational_player', { season: String(season), player_id: id, select: `team_id,${COLS}`, limit: PLAYER_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
}
