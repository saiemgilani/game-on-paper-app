/**
 * The Data API reads behind the team page's Lineups tab (BB-G3, behind 'bball-lineups'): sdv-db's lineup seasons (BB-D4,
 * sdv-db #194) in the league's season schema (`nba_stats` / `wnba_stats`, keyed by the stats.nba.com / stats.wnba.com
 * team and player ids; `mbb` / `wbb`, keyed by the ESPN team id and the stats.ncaa.org player id), one unit size per
 * read. College also reads the names of those player ids (`ncaa_player_box`) and their ESPN athlete ids
 * (`ncaa_player_crosswalk`, BB-D37) for the player-page links; the pros' names and links are the page's own season rows.
 * Every rate and percentile is the producer's (sdv-py *_lineup_seasons); the tab reads, labels and formats.
 * Reads are strict, so an outage is never shown as a team with no lineups.
 */
import { retrieveRows } from './sdv';
import { isNcaaDashboards } from '../basketball/dashboards';
import type { BasketballLeague } from '../utils/league';

/** lineup_seasons is rebuilt with the season products (once a day): the season pages' window. */
const TTL = 6 * 60 * 60;

export const UNIT_SIZES = [5, 3, 2] as const;
export type UnitSize = (typeof UNIT_SIZES)[number];

/**
 * The tab's gate select (?min=): a unit is listed with at least that many offensive possessions (the API filters
 * `poss__gte`), or, for "ranked", only the units the producer ranked (`net_rtg_pct__isnull=false`: every rated metric
 * of a unit is ranked or none is). The producer ranks units with RANK_POSS offensive plus defensive possessions.
 */
export const GATES = ['50', '100', '200', 'ranked'] as const;
export type Gate = (typeof GATES)[number];
/** The gate a team page opens on: 100 possessions in the NBA, 50 elsewhere. */
export const DEFAULT_GATE: Record<BasketballLeague, Gate> = { nba: '100', wnba: '50', mbb: '50', wbb: '50' };
/** The producer's rank gate, offense plus defense (sdv-db docs/api.md, lineup seasons). */
export const RANK_POSS: Record<BasketballLeague, number> = { nba: 400, wnba: 200, mbb: 200, wbb: 200 };
/** Most units listed, by possessions. Past it the caption says the list is the top of the team's units. */
export const UNIT_LIMIT = 100;
/** A college team-season's player box is one row per player per game (~40 games x ~15 players). */
const NAME_LIMIT = '2000';
/** A college team-season's crosswalk: one row per rostered player. */
const PAIR_LIMIT = '100';

/** The rated metrics the tab shows; each has the producer's `<m>_pct` (0-100, higher = better; null below its rank gate). */
export const RATED = ['off_rtg', 'def_rtg', 'net_rtg', 'efg_pct', 'tov_pct', 'orb_pct', 'ft_rate', 'opp_efg_pct', 'opp_tov_pct', 'opp_orb_pct', 'opp_ft_rate'] as const;
export type Rated = (typeof RATED)[number];
/** College only: the rim / mid-range / three shares of field-goal attempts and their make rates, for and against, each with `_pct`. */
export const ZONES = ['rim_rate', 'mid_rate', 'fg3_rate', 'rim_pct', 'mid_pct', 'fg3_pct', 'opp_rim_rate', 'opp_mid_rate', 'opp_fg3_rate', 'opp_rim_pct', 'opp_mid_pct', 'opp_fg3_pct'] as const;
export type Zone = (typeof ZONES)[number];

export type LineupRow = {
    lineup_id: string;
    n_players: number;
    /** stats.nba.com ids (numbers) for the pros, stats.ncaa.org ids (text) for college; null past n_players */
    player_1: number | string | null;
    player_2: number | string | null;
    player_3: number | string | null;
    player_4: number | string | null;
    player_5: number | string | null;
    minutes: number | null;
    poss: number;
    opp_poss: number;
    pts: number;
    opp_pts: number;
    plus_minus: number;
} & { [K in Rated]: number | null } & { [K in `${Rated}_pct`]: number | null }
    & { [K in Zone]?: number | null } & { [K in `${Zone}_pct`]?: number | null };

const BASE_SELECT = ['lineup_id', 'n_players', 'player_1', 'player_2', 'player_3', 'player_4', 'player_5', 'minutes', 'poss', 'opp_poss', 'pts', 'opp_pts', 'plus_minus'];
const withPct = (ms: readonly string[]) => [...ms, ...ms.map((m) => `${m}_pct`)];
/** The pros' tables carry no zone columns (selecting one would be a 400), so only college selects them. */
export const selectFor = (league: BasketballLeague) => [...BASE_SELECT, ...withPct(RATED), ...(isNcaaDashboards(league) ? withPct(ZONES) : [])].join(',');

/** One stats.ncaa.org player's name in one game of the team's. */
export interface NcaaNameRow {
    player_id: string;
    clean_name: string | null;
}

/** One stats.ncaa.org player id's ESPN athlete id (the bigint may arrive as a number). */
export interface NcaaPairRow {
    ncaa_player_id: string;
    espn_athlete_id: number | string | null;
}

export interface LineupReads {
    units: LineupRow[];
    /** college only: the team's ncaa_player_box rows; [] for the NBA/WNBA */
    names: NcaaNameRow[];
    /** college only: the team's ncaa_player_crosswalk pairs; [] for the NBA/WNBA */
    pairs: NcaaPairRow[];
}

/** College: the names of a team-season's stats.ncaa.org player ids (ESPN team id); [] for the NBA/WNBA. Strict. */
export async function retrieveNcaaNames(league: BasketballLeague, season: number, teamId: number): Promise<NcaaNameRow[]> {
    if (!isNcaaDashboards(league)) return [];
    return retrieveRows<NcaaNameRow>(league, 'ncaa_player_box', { season: String(season), team_espn_team_id: String(teamId), select: 'player_id,clean_name', limit: NAME_LIMIT }, TTL, true);
}

/** The gate's API filter. */
export function gateQuery(gate: Gate): Record<string, string> {
    return gate === 'ranked' ? { net_rtg_pct__isnull: 'false' } : { poss__gte: gate };
}

/** One unit size of one team-season, most possessions first, over the gate; college adds its players' names and ESPN ids. */
export async function retrieveLineups(league: BasketballLeague, season: number, teamId: number, size: UnitSize, gate: Gate = DEFAULT_GATE[league]): Promise<LineupReads> {
    const s = String(season);
    const college = isNcaaDashboards(league);
    const [units, names, pairs] = await Promise.all([
        retrieveRows<LineupRow>(league, 'lineup_seasons', { season: s, team_id: String(teamId), n_players: String(size), ...gateQuery(gate), order: '-poss', select: selectFor(league), limit: String(UNIT_LIMIT) }, TTL, true),
        retrieveNcaaNames(league, season, teamId),
        college
            ? retrieveRows<NcaaPairRow>(league, 'ncaa_player_crosswalk', { season: s, espn_team_id: String(teamId), select: 'ncaa_player_id,espn_athlete_id', limit: PAIR_LIMIT }, TTL, true)
            : Promise.resolve([]),
    ]);
    return { units, names, pairs };
}
