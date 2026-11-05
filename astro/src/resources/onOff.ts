/**
 * The Data API reads behind the team page's On/Off and WOWY section (BB-G4, behind 'bball-on-off'): sdv-db's
 * player_on_off and player_wowy (BB-D5, sdv-db #198) in the league's season schema (`nba_stats` / `wnba_stats`, keyed by
 * the stats.nba.com / stats.wnba.com team and player ids; `mbb` / `wbb`, keyed by the ESPN team id and the stats.ncaa.org
 * player id). College also reads its players' names (lineups' `retrieveNcaaNames`); the pros' names are the page's own
 * season rows. Every number and percentile is the producer's (sdv-py *_player_on_off / *_player_wowy); the section reads,
 * picks and formats. Reads are strict, so an outage is never shown as a team with no on/off rows.
 */
import { retrieveRows } from './sdv';
import { retrieveNcaaNames, type NcaaNameRow } from './lineups';
import type { BasketballLeague } from '../utils/league';

/** player_on_off and player_wowy are rebuilt with the season products (once a day): the season pages' window. */
const TTL = 6 * 60 * 60;

/** A team-season's players (one row per player per team; an NBA team uses ~20-30 in a season). */
export const PLAYER_LIMIT = 100;
/**
 * Every pair of the team's players is a row (C(n, 2): 190 for 20 players, 435 for 30), read whole so the player
 * select needs no second read. ponytail: 1,225 covers 50 players; two reads filtered by player_id_a / player_id_b if a
 * team-season ever has more.
 */
export const PAIR_LIMIT = 1225;

export const RATINGS = ['off_rtg', 'def_rtg', 'net_rtg'] as const;
export type Rating = (typeof RATINGS)[number];
export const SIDES = ['on', 'off', 'diff'] as const;
export type Side = (typeof SIDES)[number];

export type OnOffRow = {
    /** stats.nba.com ids (numbers) for the pros, stats.ncaa.org ids (text) for college */
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
    player_id_a: number | string;
    player_id_b: number | string;
} & { [K in `minutes_${WowySplit}`]: number } & { [K in `net_rtg_${WowySplit}`]: number | null };

const ON_OFF_SELECT = [
    'player_id', 'games', 'team_games', 'minutes_on', 'minutes_off', 'poss_on', 'poss_off',
    ...SIDES.flatMap((s) => RATINGS.map((m) => `${m}_${s}`)),
    ...(['on', 'diff'] as const).flatMap((s) => RATINGS.map((m) => `${m}_${s}_pct`)),
].join(',');
const WOWY_SELECT = ['player_id_a', 'player_id_b', ...WOWY_SPLITS.flatMap((s) => [`minutes_${s}`, `net_rtg_${s}`])].join(',');

export interface OnOffReads {
    /** most minutes on the floor first */
    players: OnOffRow[];
    pairs: WowyRow[];
    /** college only: the team's ncaa_player_box rows; [] for the NBA/WNBA */
    names: NcaaNameRow[];
}

/** One team-season's on/off rows and WOWY pairs; college adds its players' names. */
export async function retrieveOnOff(league: BasketballLeague, season: number, teamId: number): Promise<OnOffReads> {
    const q = { season: String(season), team_id: String(teamId) };
    const [players, pairs, names] = await Promise.all([
        retrieveRows<OnOffRow>(league, 'player_on_off', { ...q, order: '-minutes_on', select: ON_OFF_SELECT, limit: String(PLAYER_LIMIT) }, TTL, true),
        retrieveRows<WowyRow>(league, 'player_wowy', { ...q, select: WOWY_SELECT, limit: String(PAIR_LIMIT) }, TTL, true),
        retrieveNcaaNames(league, season, teamId),
    ]);
    return { players, pairs, names };
}
