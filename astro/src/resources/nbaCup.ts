/**
 * The Data API reads behind /nba/cup (BB-G30): sdv-db's NBA Cup snapshots (BB-D30, sdv-db #188) in nba_stats.
 * `cup_standings` and `cup_sims` are daily `(season, as_of_date)` snapshots, one row per team (stats.nba.com team ids),
 * written only inside the Cup window (the season's first game through the day after the Cup final). Every rank, seed
 * and probability is the producer's (sdv-py nba_cup_standings / nba_cup_sim); the page reads, orders and formats.
 * Reads are strict, so a failed read (a 500 before the routes deploy, an outage) is never mistaken for an empty Cup.
 */
import { retrieveRows } from './sdv';
import type { Snapshot } from '../utils/bracketology';

/** The snapshots move once a day (the season-products run): the season pages' window. */
const TTL = 6 * 60 * 60;
/** One Cup day is 30 rows; the cap keeps a bad filter from paging silently. */
const LIMIT = '100';

export interface CupStandingRow {
    season: number;
    as_of_date: string;
    /** 'East' / 'West' */
    conference: string;
    /** 'East Group A' .. 'West Group C' */
    cup_group: string;
    /** stats.nba.com team id */
    team_id: number;
    /** the place in the group under the Cup tiebreakers, 1 = best */
    group_rank: number;
    /** Group Play only */
    wins: number;
    losses: number;
    games_remaining: number;
    /** Group Play, without overtime (a tiebreaker) */
    point_diff: number;
    points: number;
    /** last season's winning percentage (a tiebreaker) */
    prior_win_pct: number | null;
    /** the criterion that placed the team ('head_to_head', 'point_diff', 'points', 'prior_record', 'random'); null when the record alone did */
    tiebreak: string | null;
    /** the group leaders 1-3, then the wild-card race (the runners-up, then the rest) */
    conference_rank: number;
    leads_group: boolean;
    holds_wild_card: boolean;
    /** 1-4 on the current table (the three group leaders, then the wild card), else null */
    knockout_seed: number | null;
}

export interface CupSimRow {
    season: number;
    as_of_date: string;
    conference: string;
    cup_group: string;
    team_id: number;
    /** Group Play so far */
    wins: number;
    losses: number;
    point_diff: number;
    adj_net_rtg: number | null;
    p_win_group: number;
    p_wild_card: number;
    /** a knockout seed: the group or the wild card */
    p_quarterfinal: number;
    p_semifinal: number;
    p_final: number;
    p_champion: number;
    /** each probability's Monte Carlo error */
    p_win_group_se: number | null;
    p_wild_card_se: number | null;
    p_quarterfinal_se: number | null;
    p_semifinal_se: number | null;
    p_final_se: number | null;
    p_champion_se: number | null;
    mean_group_rank: number | null;
    n_sims: number;
}

export interface CupSnapshot {
    standings: CupStandingRow[];
    sims: CupSimRow[];
}

/** The latest Cup snapshot day of `season`, or of any season when it is omitted; null when there is none. */
export async function retrieveLatestCupSnapshot(season?: number): Promise<Snapshot | null> {
    const rows = await retrieveRows<Snapshot>('nba', 'cup_sims', {
        ...(season != null ? { season: String(season) } : {}), order: '-as_of_date', limit: '1', select: 'season,as_of_date',
    }, TTL, true);
    return rows[0] ? { season: Number(rows[0].season), as_of_date: String(rows[0].as_of_date) } : null;
}

/** The standings and sims on one snapshot day. */
export async function retrieveCupSnapshot({ season, as_of_date }: Snapshot): Promise<CupSnapshot> {
    const day = { season: String(season), as_of_date, limit: LIMIT };
    const [standings, sims] = await Promise.all([
        retrieveRows<CupStandingRow>('nba', 'cup_standings', day, TTL, true),
        retrieveRows<CupSimRow>('nba', 'cup_sims', day, TTL, true),
    ]);
    return { standings, sims };
}
