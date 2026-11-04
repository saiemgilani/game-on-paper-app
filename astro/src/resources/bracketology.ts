/**
 * The Data API reads behind /<mbb|wbb>/bracketology (BB-G22): sdv-db's daily college season snapshots (BB-D17),
 * one row per `(season, as_of_date, team_id)` in `season_sims`, `bracketology` and `team_resume`. Every rank,
 * percentile and probability is the producer's (sdv-py mbb_season_projections / mbb_bracketology /
 * mbb_strength_of_schedule); the page reads, orders and formats. Reads are strict, so an outage (503) is never
 * mistaken for an empty season.
 */
import { retrieveRows } from './sdv';
import type { BasketballLeague } from '../utils/league';
import type { Snapshot } from '../utils/bracketology';

/** The snapshots move once a day (the 16:00 UTC season-products run): the season pages' window. */
const TTL = 6 * 60 * 60;
/** One season-day is ~365 rows; the cap keeps a bad filter from paging silently. */
const LIMIT = '1000';

export interface SeasonSimRow {
    team_id: number;
    team: string;
    conference_id: number;
    conference: string;
    wins: number;
    losses: number;
    conf_wins: number;
    conf_losses: number;
    proj_wins: number;
    proj_losses: number;
    proj_conf_wins: number;
    proj_conf_losses: number;
    proj_conf_win_pct_rank: number | null;
    reg_season_title_prob: number;
    conf_tourney_title_prob: number;
    auto_bid_prob: number;
    at_large_prob: number;
    bid_prob: number;
    seed_mean: number | null;
    n_sims: number;
    /** seed_1_prob .. seed_16_prob */
    [seed: `seed_${number}_prob`]: number;
}

export interface BracketologyRow {
    team_id: number;
    team: string;
    conference: string;
    wins: number;
    losses: number;
    net_estimate_rank: number | null;
    rpi_rank: number | null;
    wab: number | null;
    quad1_w: number;
    quad1_l: number;
    resume_score: number;
    auto_bid: boolean;
    at_large_rank: number | null;
    bid: boolean;
    projected_seed: number | null;
    at_large_prob: number | null;
    bubble: string | null;
}

export interface TeamResumeRow {
    team_id: number;
    team: string;
    conference_id: number;
    conference: string;
    wins: number;
    losses: number;
    wab: number | null;
    quad1_w: number; quad1_l: number;
    quad2_w: number; quad2_l: number;
    quad3_w: number; quad3_l: number;
    quad4_w: number; quad4_l: number;
    net_estimate_rank: number | null; net_estimate_pct: number | null;
    rpi_rank: number | null; rpi_pct: number | null;
    sos_rank: number | null; sos_pct: number | null;
    wab_rank: number | null; wab_pct: number | null;
}

export interface CollegeSnapshot {
    sims: SeasonSimRow[];
    bracket: BracketologyRow[];
    resume: TeamResumeRow[];
}

/** The latest snapshot day of `season`, or of any season when it is omitted; null when there is none. */
export async function retrieveLatestSnapshot(league: BasketballLeague, season?: number): Promise<Snapshot | null> {
    const rows = await retrieveRows<Snapshot>(league, 'season_sims', {
        ...(season != null ? { season: String(season) } : {}), order: '-as_of_date', limit: '1', select: 'season,as_of_date',
    }, TTL, true);
    return rows[0] ? { season: Number(rows[0].season), as_of_date: String(rows[0].as_of_date) } : null;
}

/** The three tables on one snapshot day. */
export async function retrieveSnapshot(league: BasketballLeague, { season, as_of_date }: Snapshot): Promise<CollegeSnapshot> {
    const q = { season: String(season), as_of_date, limit: LIMIT };
    const [sims, bracket, resume] = await Promise.all([
        retrieveRows<SeasonSimRow>(league, 'season_sims', q, TTL, true),
        retrieveRows<BracketologyRow>(league, 'bracketology', q, TTL, true),
        retrieveRows<TeamResumeRow>(league, 'team_resume', q, TTL, true),
    ]);
    return { sims, bracket, resume };
}
