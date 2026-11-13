/**
 * The Data API reads behind the player page's On/Off section (BB-G7, behind 'bball-player-on-off'): sdv-db's
 * player_on_off and player_wowy (BB-D5, sdv-db #198) in the league's season schema. The pros' (`nba_stats` /
 * `wnba_stats`) are keyed by the stats.nba.com / stats.wnba.com person id, the page's own id. College's (`mbb` / `wbb`)
 * are keyed by stats.ncaa.org player ids with ESPN team ids, so they go through ncaa_player_crosswalk to and from the
 * page's ESPN athlete id. Every number and percentile is the producer's (sdv-py *_player_on_off / *_player_wowy). Reads
 * are strict, so an outage is never shown as a player with no rows.
 *
 * ponytail: the row types, RATINGS and the two selects are #407's resources/onOff.ts (BB-G4, the team page) plus
 * `team_id`; fold this file into that one once both merge.
 */
import { retrieveRows } from './sdv';
import { PRO_LEAGUES, type BasketballLeague } from '../utils/league';

/** player_on_off and player_wowy are rebuilt with the season products (once a day): the season pages' window. */
const TTL = 6 * 60 * 60;
/** One row per team he played for in the season; the cap keeps a bad filter from paging. */
export const TEAM_LIMIT = 5;
/**
 * His pairs on one side of the producer's id order (player_id_a is the smaller id): at most one per teammate per team,
 * ~20-30 for a season with one team.
 */
export const PAIR_LIMIT = 100;

export const RATINGS = ['off_rtg', 'def_rtg', 'net_rtg'] as const;
export type Rating = (typeof RATINGS)[number];
export const SIDES = ['on', 'off', 'diff'] as const;
export type Side = (typeof SIDES)[number];

export type OnOffRow = {
    team_id: number;
    /** the stats.nba.com / stats.wnba.com person id; the stats.ncaa.org id (text) in college */
    player_id: number | string;
    /** games he played for the team, of the team's */
    games: number;
    team_games: number;
    minutes_on: number;
    minutes_off: number;
    poss_on: number;
    poss_off: number;
} & { [K in `${Rating}_${Side}`]: number | null } & { [K in `${Rating}_${'on' | 'diff'}_pct`]: number | null };

export const WOWY_SPLITS = ['both', 'a_only', 'b_only', 'neither'] as const;
export type WowySplit = (typeof WOWY_SPLITS)[number];

/** One pair (player_id_a the smaller id): the team's season split four ways. */
export type WowyRow = {
    team_id: number;
    player_id_a: number | string;
    player_id_b: number | string;
} & { [K in `minutes_${WowySplit}`]: number } & { [K in `net_rtg_${WowySplit}`]: number | null };

export const ON_OFF_SELECT = [
    'team_id', 'player_id', 'games', 'team_games', 'minutes_on', 'minutes_off', 'poss_on', 'poss_off',
    ...SIDES.flatMap((s) => RATINGS.map((m) => `${m}_${s}`)),
    ...(['on', 'diff'] as const).flatMap((s) => RATINGS.map((m) => `${m}_${s}_pct`)),
].join(',');
export const WOWY_SELECT = ['team_id', 'player_id_a', 'player_id_b', ...WOWY_SPLITS.flatMap((s) => [`minutes_${s}`, `net_rtg_${s}`])].join(',');

export interface PlayerOnOffReads {
    /** his on/off rows, one per team, most minutes on the floor first */
    teams: OnOffRow[];
    /** every pair he is in, either side */
    pairs: WowyRow[];
    /** the id his rows are keyed by (the page's for the pros, his stats.ncaa.org id in college); null: no crosswalk pair */
    playerId: string | null;
    /** college: stats.ncaa.org id -> ESPN athlete id for his team-season; null for the pros (their rows carry the page's ids) */
    toEspn: Map<string, string> | null;
}

/** A college team-season's roster is ~15-20 matched players; the cap keeps a bad filter from paging. */
export const ROSTER_LIMIT = 40;

/**
 * College: the team-season's stats.ncaa.org -> ESPN athlete pairs (ncaa_player_crosswalk, BB-D37; a new stats.ncaa.org
 * id every season, so always season-filtered). `espn_athlete_id` is a bigint and `ncaa_player_id` text: both become
 * strings here, the one type every id is compared in.
 */
async function collegePairs(league: BasketballLeague, season: string, espnTeamId: number): Promise<Map<string, string>> {
    const rows = await retrieveRows<{ ncaa_player_id: string | null; espn_athlete_id: number | string | null }>(league, 'ncaa_player_crosswalk',
        { season, espn_team_id: String(espnTeamId), select: 'ncaa_player_id,espn_athlete_id', limit: String(ROSTER_LIMIT) }, TTL, true);
    return new Map(rows.filter((r) => r.ncaa_player_id && r.espn_athlete_id != null).map((r) => [String(r.ncaa_player_id), String(r.espn_athlete_id)]));
}

/**
 * One player-season's on/off rows and WOWY pairs: three reads, each filtered by season and his id. The pros' rows carry
 * the page's id. College's carry stats.ncaa.org ids, so his team's crosswalk pairs are read first (`teamId`, the page's
 * ESPN team id); a player with no matched pair reads nothing more and has no rows.
 * ponytail: one team's pairs; a player who changed teams mid-season keeps only that team's rows (his other team's
 * stats.ncaa.org id is not in them). Read his own crosswalk rows first if that ever matters.
 */
export async function retrievePlayerOnOff(league: BasketballLeague, season: number, personId: number, teamId: number): Promise<PlayerOnOffReads> {
    const s = String(season);
    const toEspn = PRO_LEAGUES.includes(league) ? null : await collegePairs(league, s, teamId);
    const id = toEspn ? [...toEspn].find(([, espn]) => espn === String(personId))?.[0] : String(personId);
    if (id === undefined) return { teams: [], pairs: [], playerId: null, toEspn };
    const pairs = (side: 'player_id_a' | 'player_id_b') =>
        retrieveRows<WowyRow>(league, 'player_wowy', { season: s, [side]: id, select: WOWY_SELECT, limit: String(PAIR_LIMIT) }, TTL, true);
    const [teams, asA, asB] = await Promise.all([
        retrieveRows<OnOffRow>(league, 'player_on_off', { season: s, player_id: id, order: '-minutes_on', select: ON_OFF_SELECT, limit: String(TEAM_LIMIT) }, TTL, true),
        pairs('player_id_a'),
        pairs('player_id_b'),
    ]);
    return { teams, pairs: [...asA, ...asB], playerId: id, toEspn };
}
