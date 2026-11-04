/**
 * The Data API reads behind /<nba|wnba>/standings (BB-G23): sdv-db's pro season products (BB-D18, sdv-db #186), in
 * nba_stats / wnba_stats. `season_sims` and `season_standings` are daily `(season, as_of_date)` snapshots, one row per
 * team (stats.nba.com team ids); `lottery_odds` is one row per `(season, lottery_slot, pick)`, written only when the
 * league has published chances for its number of lottery teams (the 2027 WNBA lottery's seven have none). Every
 * probability, seed and rank is the producer's (sdv-py nba_season_sim / nba_season_standings / nba_draft_lottery_odds);
 * the page reads, orders and formats. Reads are strict, so an outage (503) is never mistaken for an empty season.
 */
import { retrieveRows } from './sdv';
import type { Snapshot } from '../utils/bracketology';
import type { ProLeague } from '../utils/playoffPicture';

/** The snapshots move once a day (the season-products run): the season pages' window. */
const TTL = 6 * 60 * 60;
/** One season-day is 30 rows (NBA) and the lottery grid 196; the cap keeps a bad filter from paging silently. */
const LIMIT = '500';

export interface ProSimRow {
    season: number;
    as_of_date: string;
    /** stats.nba.com / stats.wnba.com team id */
    team_id: number;
    /** 'East' / 'West'; the WNBA's one table says 'WNBA' */
    conference: string | null;
    division: string | null;
    wins: number;
    losses: number;
    games_remaining: number;
    adj_net_rtg: number | null;
    adj_net_rtg_sd: number | null;
    proj_wins: number;
    proj_losses: number;
    proj_wins_sd: number | null;
    proj_wins_p10: number | null;
    proj_wins_p90: number | null;
    /** Monte Carlo error of proj_wins */
    proj_wins_se: number | null;
    /** NBA only */
    p_division: number | null;
    /** p_seed_1 .. p_seed_15: the finish in the conference (NBA) or the league (WNBA) */
    [seed: `p_seed_${number}`]: number | null;
    mean_seed: number | null;
    p_top4: number | null;
    /** NBA only */
    p_top6: number | null;
    /** NBA only: seeds 7-10 */
    p_play_in: number | null;
    p_playoffs: number | null;
    /** Monte Carlo error of p_playoffs */
    p_playoffs_se: number | null;
    p_lottery: number | null;
    /** null when the league has no published lottery chances for that many teams */
    p_pick_1: number | null;
    p_drawn_pick: number | null;
    mean_pick: number | null;
    n_sims: number;
}

export interface ProStandingRow {
    season: number;
    as_of_date: string;
    team_id: number;
    conference: string | null;
    division: string | null;
    games: number;
    wins: number;
    losses: number;
    win_pct: number | null;
    point_diff: number | null;
    /** 1 = the division winner (the WNBA's one 'division' is the league) */
    division_rank: number | null;
    division_leader: boolean | null;
    /** the official tiebreak seed: in the conference (NBA) or the league (WNBA), 1 = best */
    seed: number;
    /** games behind the seed-1 team */
    games_back: number | null;
}

export interface LotteryOddsRow {
    season: number;
    /** 1 = the worst record */
    lottery_slot: number;
    chances: number | null;
    pick: number;
    probability: number | null;
}

export interface ProSnapshot {
    sims: ProSimRow[];
    standings: ProStandingRow[];
    lottery: LotteryOddsRow[];
}

/** The latest snapshot day of `season`, or of any season when it is omitted; null when there is none. */
export async function retrieveLatestProSnapshot(league: ProLeague, season?: number): Promise<Snapshot | null> {
    const rows = await retrieveRows<Snapshot>(league, 'season_sims', {
        ...(season != null ? { season: String(season) } : {}), order: '-as_of_date', limit: '1', select: 'season,as_of_date',
    }, TTL, true);
    return rows[0] ? { season: Number(rows[0].season), as_of_date: String(rows[0].as_of_date) } : null;
}

/** The sims and standings on one snapshot day, and the season's lottery odds. */
export async function retrieveProSnapshot(league: ProLeague, { season, as_of_date }: Snapshot): Promise<ProSnapshot> {
    const day = { season: String(season), as_of_date, limit: LIMIT };
    const [sims, standings, lottery] = await Promise.all([
        retrieveRows<ProSimRow>(league, 'season_sims', day, TTL, true),
        retrieveRows<ProStandingRow>(league, 'season_standings', day, TTL, true),
        retrieveRows<LotteryOddsRow>(league, 'lottery_odds', { season: String(season), limit: LIMIT }, TTL, true),
    ]);
    return { sims, standings, lottery };
}
