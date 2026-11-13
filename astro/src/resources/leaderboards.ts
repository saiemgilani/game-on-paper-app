/**
 * The Data API reads behind the basketball leaderboards (BB-G8, behind 'bball-leaderboards-v2'). One board, one season,
 * one capped read (plus the lineup board's names):
 * - Impact: `player_impact` in the games schema (`nba` / `wnba`, the regular season), or `ncaa_rapm` (`mbb` / `wbb`);
 * - Teams: `team_season_rates` (split `all`; BB-D3), `team_strength` (BB-D19) or `team_season_flow` (BB-D27) in the
 *   league's season schema;
 * - Lineups: `lineup_seasons` (BB-D4) for one unit size, named from the season's shot_season_players (the pros' stats ids)
 *   or ncaa_rapm (college's stats.ncaa.org ids).
 * Every value, `_rank` and `_pct` is the producer's (rule B6); the board reads, orders and formats. Reads are strict, so
 * an outage is never shown as an empty board.
 */
import { retrieveRows, retrieveRowsFrom } from './sdv';
import { retrieveSeasonPlayerRows } from './nbaShots';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { leagueSource, PRO_LEAGUES, type BasketballLeague } from '../utils/league';
import { boardSpec, srcFor, BASES, ncaaName, type Board, type BoardSpec, type TeamGroup, type UnitSize } from '../utils/leaderboards';

/** The season products are rebuilt once a day: the season pages' window. */
const TTL = 6 * 60 * 60;

/** Most rows a board reads. A college season has ~4,000 rated players and ~365 teams; the impact and lineup reads keep the most-used. */
export const BOARD_CAP = 500;
const TEAM_CAP = '400';
/** A college season's ncaa_rapm rows over the lineup floor (4,048 in 2025-26 at 100): the lineup board's names. */
const NAME_CAP = '6000';

/** The impact read's floor, in offensive possessions: below it a player is never listed, even with "all players". */
export const IMPACT_FLOOR: Record<BasketballLeague, number> = { nba: 250, wnba: 100, mbb: 100, wbb: 100 };
/**
 * The lineup read's floor, in offensive possessions: about half the producer's rank gate (400 offensive plus defensive
 * possessions in the NBA, 200 in the WNBA and college; sdv-py nba_lineup_seasons `_MIN_POSS`), so "all units" adds the
 * near-misses and the qualified view is exactly the producer's ranked units.
 */
export const LINEUP_FLOOR: Record<BasketballLeague, number> = { nba: 150, wnba: 75, mbb: 75, wbb: 75 };
/** BB-G27's POE read floor, in field-goal attempts: a third of the board's qualifier (POE_QUALIFIED_FGA). */
export const POE_FLOOR: Record<BasketballLeague, number> = { nba: 100, wnba: 50, mbb: 40, wbb: 40 };

/** Producer columns with no `_rank` / `_pct`: counts and samples. Every other column a board shows is ranked by the producer. */
const UNRANKED = new Set(['games', 'poss', 'pts', 'opp_pts', 'wins', 'minutes', 'plus_minus', 'runs_10', 'opp_runs_10', 'kills', 'double_kills']);

/** The read's `select`: the board's columns on every basis, their producer rank and percentile, and the identity columns. */
export function selectFor(spec: BoardSpec, identity: readonly string[], ranked: boolean): string {
    const srcs = spec.cols.flatMap((c) => BASES.map((b) => srcFor(c, b))).filter((s): s is string => s != null);
    const rankCols = ranked ? srcs.filter((s) => !UNRANKED.has(s)).flatMap((s) => [`${s}_rank`, `${s}_pct`]) : [];
    return [...new Set([...identity, ...srcs, ...rankCols, ...(spec.qualifiedBy ? [spec.qualifiedBy] : [])])].join(',');
}

export type BoardRow = Record<string, unknown>;
export interface BoardReads {
    rows: BoardRow[];
    /** lineups: player id -> name; empty for the other boards */
    names: Map<string, string>;
}

const TEAM_TABLE: Record<TeamGroup, string> = { ratings: 'team_season_rates', factors: 'team_season_rates', strength: 'team_strength', flow: 'team_season_flow' };
export const LINEUP_IDENTITY = ['team_id', 'lineup_id', 'n_players', 'player_1', 'player_2', 'player_3', 'player_4', 'player_5'] as const;
const PRO_IMPACT_IDENTITY = ['player_id', 'player_name', 'team_id', 'team_abbreviation', 'teams'] as const;
const COLLEGE_IMPACT_IDENTITY = ['player_id', 'player', 'team'] as const;
export const VALUE_IDENTITY = ['player_id', 'player_name', 'team_id', 'teams'] as const;
/** player_war ranks VORP and WAR only (sdv-py attach_ranks), so the read asks for those four and no other `_rank` / `_pct`. */
const VALUE_RANKS = ['vorp_rank', 'vorp_pct', 'war_rank', 'war_pct'] as const;
export const POE_IDENTITY = ['person_id', 'team_id', 'team_tricode'] as const;

export async function retrieveBoard(league: BasketballLeague, season: number, board: Board, group: TeamGroup, unit: UnitSize): Promise<BoardReads> {
    const s = String(season);
    const spec = boardSpec(board, league, group);
    if (board === 'value') {
        // the season schema's player_war (sdv-db #202): the regular season for the pros; strict, so a 404 before its
        // backfill is the board's "unavailable" line, never an empty board
        const select = `${selectFor(spec, VALUE_IDENTITY, false)},${VALUE_RANKS.join(',')}`;
        const rows = await retrieveRowsFrom<BoardRow>(leagueSource(league), 'player_war', { season: s, poss__gte: String(IMPACT_FLOOR[league]), order: '-poss', select, limit: String(BOARD_CAP) }, TTL, true, NBA_READ_TIMEOUT_MS);
        return { rows, names: new Map() };
    }
    if (board === 'poe') {
        // shot_quality_season's player rows (one per player and team), named from the season players: the same person id
        // (stats.nba.com's for the pros, ESPN's in college) the player pages use
        const [rows, names] = await Promise.all([
            retrieveRowsFrom<BoardRow>(leagueSource(league), 'shot_quality_season', { season: s, level: 'player', attempts__gte: String(POE_FLOOR[league]), order: '-attempts', select: selectFor(spec, POE_IDENTITY, false), limit: String(BOARD_CAP) }, TTL, true, NBA_READ_TIMEOUT_MS),
            retrieveSeasonPlayerRows(season, league).then((ps) => ps.map((p) => [String(p.person_id), p.player_name] as const)),
        ]);
        return { rows, names: new Map(names) };
    }
    const pro = PRO_LEAGUES.includes(league);
    if (board === 'impact') {
        const q = { season: s, off_poss__gte: String(IMPACT_FLOOR[league]), order: '-off_poss', limit: String(BOARD_CAP) };
        const rows = pro
            ? await retrieveRowsFrom<BoardRow>(BASKETBALL[league].gamesSource, 'player_impact', { ...q, season_type: 'Regular Season', select: selectFor(spec, PRO_IMPACT_IDENTITY, false) }, TTL, true)
            : await retrieveRows<BoardRow>(league, 'ncaa_rapm', { ...q, estimand: 'league', select: selectFor(spec, COLLEGE_IMPACT_IDENTITY, false) }, TTL, true);
        return { rows, names: new Map() };
    }
    if (board === 'teams') {
        const split: Record<string, string> = TEAM_TABLE[group] === 'team_season_rates' ? { split: 'all' } : {};
        const rows = await retrieveRows<BoardRow>(league, TEAM_TABLE[group], { season: s, ...split, select: selectFor(spec, ['team_id'], true), limit: TEAM_CAP }, TTL, true);
        return { rows, names: new Map() };
    }
    const floor = String(LINEUP_FLOOR[league]);
    const [rows, names] = await Promise.all([
        retrieveRows<BoardRow>(league, 'lineup_seasons', { season: s, n_players: String(unit), poss__gte: floor, order: '-poss', select: selectFor(spec, LINEUP_IDENTITY, true), limit: String(BOARD_CAP) }, TTL, true),
        pro
            ? retrieveSeasonPlayerRows(season, league).then((ps) => ps.map((p) => [String(p.person_id), p.player_name] as const))
            // a player in a listed unit has at least the floor's possessions himself
            : retrieveRows<{ player_id: string; player: string | null }>(league, 'ncaa_rapm', { season: s, estimand: 'league', off_poss__gte: floor, select: 'player_id,player', limit: NAME_CAP }, TTL, true)
                .then((ps) => ps.filter((p) => p.player).map((p) => [String(p.player_id), ncaaName(p.player!)] as const)),
    ]);
    return { rows, names: new Map(names) };
}
