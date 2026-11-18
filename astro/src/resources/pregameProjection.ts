/**
 * The Data API read behind BB-G18 (behind 'bball-pregame-projection'): the game's one `{lg}.rated_priors` row (sdv-py#1193,
 * sdv-db#229), the producer's pregame prediction as published. The site computes nothing: the expected margin, the win
 * chance and each side's rating are the producer's (college ratings already carry its preseason prior blend). Keyed by the
 * ESPN game id in all four leagues. Strict: an outage throws, and is never shown as a game with no projection.
 *
 * The pros serve the rated prior (BB-D25, sdv-py#1217, sdv-db#236): the `wp_prior_*` columns, the number the WP chart starts
 * from on a game with no line, rated from opening night and shrunk toward last season. They replace the row's team_strength
 * closed form (`exp_home_margin`, `rated_home_prob`, the ratings, ranks and home term) here, so every reader of this row
 * (the pregame card, the Lines panel, the team schedule) shows one number. College has no rated prior: its row is as published.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, type BasketballLeague } from '../utils/league';

/** The producer rebuilds the table nightly: the season products' window. */
const TTL = 6 * 60 * 60;

/** One `rated_priors` row: the columns the card reads (the pros also carry pace, college the raw rating and prior_games). */
export interface RatedPrior {
    season: number;
    game_id: number | string;
    as_of_date: string;
    home_team_id: number | string;
    away_team_id: number | string;
    neutral_site: boolean;
    home_rating: number | null;
    away_rating: number | null;
    home_rank: number | null;
    away_rank: number | null;
    home_games: number | null;
    away_games: number | null;
    hfa: number;
    /** college only: the games the preseason prior is worth (4 men, 3 women) */
    prior_games?: number | null;
    /** null before a side's first game (the pros' opening week; their rated prior has one from opening night) */
    exp_home_margin: number | null;
    rated_home_prob: number | null;
    /** the pros only (sdv-db#236): BB-D25's rated prior; null only for an unmatched ESPN game (All-Star, the Cup final) */
    wp_prior_home_rating?: number | null;
    wp_prior_away_rating?: number | null;
    wp_prior_home_rank?: number | null;
    wp_prior_away_rank?: number | null;
    /** in points; 0 at a neutral site */
    wp_prior_hfa?: number | null;
    wp_prior_exp_home_margin?: number | null;
    wp_prior_home_prob?: number | null;
}

/** The pros' row with the rated prior in the closed form's place; the games played stay (the prior has no count). */
export const servedPrior = (r: RatedPrior): RatedPrior => ({
    ...r,
    home_rating: r.wp_prior_home_rating ?? null,
    away_rating: r.wp_prior_away_rating ?? null,
    home_rank: r.wp_prior_home_rank ?? null,
    away_rank: r.wp_prior_away_rank ?? null,
    hfa: r.wp_prior_hfa ?? r.hfa,
    exp_home_margin: r.wp_prior_exp_home_margin ?? null,
    rated_home_prob: r.wp_prior_home_prob ?? null,
});

/** The game's row, or null when the producer has none (a preseason game, a non-D-I opponent). */
export async function retrieveRatedPrior(league: BasketballLeague, season: number, gameId: string): Promise<RatedPrior | null> {
    const rows = await retrieveRowsFrom<RatedPrior>(BASKETBALL[league].gamesSource, 'rated_priors', { season: String(season), game_id: gameId, limit: '1' },
        TTL, true, NBA_READ_TIMEOUT_MS);
    const row = rows[0] ?? null;
    return row && PRO_LEAGUES.includes(league) ? servedPrior(row) : row;
}
