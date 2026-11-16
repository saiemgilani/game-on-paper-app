/**
 * The Data API read behind BB-G18 (behind 'bball-pregame-projection'): the game's one `{lg}.rated_priors` row (sdv-py#1193,
 * sdv-db#229), the producer's pregame prediction as published. The site computes nothing: the expected margin, the win
 * chance and each side's rating are the producer's (college ratings already carry its preseason prior blend). Keyed by the
 * ESPN game id in all four leagues. Strict: an outage throws, and is never shown as a game with no projection.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';

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
    /** null before a side's first game (the pros' opening week) */
    exp_home_margin: number | null;
    rated_home_prob: number | null;
}

/** The game's row, or null when the producer has none (a preseason game, a non-D-I opponent). */
export async function retrieveRatedPrior(league: BasketballLeague, season: number, gameId: string): Promise<RatedPrior | null> {
    const rows = await retrieveRowsFrom<RatedPrior>(BASKETBALL[league].gamesSource, 'rated_priors', { season: String(season), game_id: gameId, limit: '1' },
        TTL, true, NBA_READ_TIMEOUT_MS);
    return rows[0] ?? null;
}
