/**
 * The Data API reads behind the team page's Lineups tab (BB-G3, behind 'bball-lineups'): sdv-db's lineup seasons (BB-D4,
 * sdv-db #194) in the league's season schema (`nba_stats` / `wnba_stats`, keyed by the stats.nba.com / stats.wnba.com
 * team and player ids; `mbb` / `wbb`, keyed by the ESPN team id and the stats.ncaa.org player id), one unit size per
 * read. College also reads the names of those player ids (`ncaa_player_box`); the pros' names are the page's own season
 * rows. Every rate and percentile is the producer's (sdv-py *_lineup_seasons); the tab reads, labels and formats.
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
 * The tab's gate: a unit is listed with at least this many offensive possessions (the API filters `poss__gte`). The
 * producer ranks only units with 400 offensive plus defensive possessions (NBA; 200 WNBA and college), which leaves
 * most teams one or two ranked five-man units, so the tab lists more and shades only what the producer ranked.
 * ponytail: one gate for every unit size; a per-size gate or a gate select if a 2-man list reads too long.
 */
export const MIN_POSS: Record<BasketballLeague, number> = { nba: 100, wnba: 50, mbb: 50, wbb: 50 };
/** Most units listed, by possessions. Past it the caption says the list is the top of the team's units. */
export const UNIT_LIMIT = 100;
/** A college team-season's player box is one row per player per game (~40 games x ~15 players). */
const NAME_LIMIT = '2000';

/** The rated metrics the tab shows; each has the producer's `<m>_pct` (0-100, higher = better; null below its rank gate). */
export const RATED = ['off_rtg', 'def_rtg', 'net_rtg', 'efg_pct', 'tov_pct', 'orb_pct', 'ft_rate', 'opp_efg_pct', 'opp_tov_pct', 'opp_orb_pct', 'opp_ft_rate'] as const;
export type Rated = (typeof RATED)[number];

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
} & { [K in Rated]: number | null } & { [K in `${Rated}_pct`]: number | null };

const SELECT = [
    'lineup_id', 'n_players', 'player_1', 'player_2', 'player_3', 'player_4', 'player_5',
    'minutes', 'poss', 'opp_poss', 'pts', 'opp_pts', 'plus_minus', ...RATED, ...RATED.map((m) => `${m}_pct`),
].join(',');

/** One stats.ncaa.org player's name in one game of the team's. */
export interface NcaaNameRow {
    player_id: string;
    clean_name: string | null;
}

export interface LineupReads {
    units: LineupRow[];
    /** college only: the team's ncaa_player_box rows; [] for the NBA/WNBA */
    names: NcaaNameRow[];
}

/** One unit size of one team-season, most possessions first, over the gate; college adds its players' names. */
export async function retrieveLineups(league: BasketballLeague, season: number, teamId: number, size: UnitSize): Promise<LineupReads> {
    const s = String(season);
    const [units, names] = await Promise.all([
        retrieveRows<LineupRow>(league, 'lineup_seasons', { season: s, team_id: String(teamId), n_players: String(size), poss__gte: String(MIN_POSS[league]), order: '-poss', select: SELECT, limit: String(UNIT_LIMIT) }, TTL, true),
        retrieveNcaaNames(league, season, teamId),
    ]);
    return { units, names };
}

/** College's stats.ncaa.org names for one team-season (ncaa_player_box, strict); [] for the NBA/WNBA, whose names are the page's season rows. */
export function retrieveNcaaNames(league: BasketballLeague, season: number, teamId: number): Promise<NcaaNameRow[]> {
    return isNcaaDashboards(league)
        ? retrieveRows<NcaaNameRow>(league, 'ncaa_player_box', { season: String(season), team_espn_team_id: String(teamId), select: 'player_id,clean_name', limit: NAME_LIMIT }, TTL, true)
        : Promise.resolve([]);
}
