/**
 * BB-G18's pregame projection: the producer's closed-form pregame prediction applied to the producer's ratings. Nothing is
 * fitted here; the constants and the formulas are sportsdataverse-py's (main 306abe15), cited below, and
 * test/pregameProjection.test.ts checks every number against sdv-py run on the same Data API rows.
 *
 * - College (mbb / wbb): `{lg}.ratings.adj_em` (sdv-py's adjusted-efficiency engine, model 1), with
 *   `mbb_game_predict.predict_margin` (L162) and `win_prob_from_margin` (L196):
 *   margin = em_scale * (home_adj_em - away_adj_em) + hfa, hfa 0 at a neutral site; P(home) = Phi(margin / margin_sd).
 * - Pros (nba / wnba): BB-D19's `{lg}_stats.team_strength` (adj_net_rtg, pace), with `nba_game_predict.predict_margin`
 *   (L67), `expected_possessions` (L46) and `win_prob_from_margin` (L105):
 *   margin = (home_adj_net - away_adj_net) * (home_pace * away_pace / avg_pace) / 100 + hfa; P(home) = Phi(margin / margin_sd).
 */
import { calculateNormCdf } from './misc';
import type { BasketballLeague } from './league';

/**
 * The fitted constants, points. College: sdv-py `mbb/mbb_prediction_constants.py` LEAGUE_CONSTANTS (L104-121, fitted on the
 * 2024 as-of-date backtests, dev/mbb_prediction/fit_pregame.py). Pros: `nba/nba_prediction_constants.py` LEAGUE_CONSTANTS
 * (L93-108, fitted on as-of-date backtests, tools/models/nba_prediction/fit_pregame.py: NBA 2023-24, WNBA 2024).
 */
export const PREGAME_CONSTANTS = {
    mbb: { hfa: 2.9281, margin_sd: 11.2196, em_scale: 0.5766 },
    wbb: { hfa: 2.6432, margin_sd: 12.1716, em_scale: 0.623 },
    nba: { hfa: 2.184, margin_sd: 14.504, avg_pace: 99.5 },
    wnba: { hfa: 1.184, margin_sd: 10.944, avg_pace: 95.0 },
} as const;

/** One team's producer rating: college adj_em and its rank; pro adj_net_rtg, its rank and pace. */
export interface TeamRating {
    team_id: string;
    rating: number;
    rank: number | null;
    games: number | null;
    /** pros only (team_strength.pace) */
    pace: number | null;
}

export interface Projection {
    /** expected home-minus-away margin, points */
    margin: number;
    homeWinProb: number;
    /** the home edge the margin carries: the league's hfa, or 0 at a neutral site */
    hfa: number;
}

/** The producer's projection for `home` against `away`; null when a rating (or a pro pace) is missing or not finite. */
export function projectGame(league: BasketballLeague, home: TeamRating, away: TeamRating, neutral: boolean): Projection | null {
    const ok = (x: number | null): x is number => x != null && Number.isFinite(x);
    if (!ok(home.rating) || !ok(away.rating)) return null;
    let margin: number;
    let hfa: number;
    if (league === 'mbb' || league === 'wbb') {
        const c = PREGAME_CONSTANTS[league];
        hfa = neutral ? 0 : c.hfa;
        margin = c.em_scale * (home.rating - away.rating) + hfa;
    } else {
        const c = PREGAME_CONSTANTS[league];
        if (!ok(home.pace) || !ok(away.pace)) return null;
        hfa = neutral ? 0 : c.hfa;
        margin = ((home.rating - away.rating) * (home.pace * away.pace / c.avg_pace)) / 100 + hfa;
    }
    return { margin, homeWinProb: calculateNormCdf(margin, 0, PREGAME_CONSTANTS[league].margin_sd), hfa };
}

/**
 * Q1 (until the producer publishes its prior-blended college rating): the college card waits until both teams have played
 * as many games as the producer's preseason prior is worth, sdv-py `mbb/mbb_prediction_constants.py` PRESEASON_PRIOR
 * weight (L167-169: men 4.0, women 3.0). Before then the raw season-to-date rating alone is too noisy to print.
 */
export const PRIOR_GAMES = { mbb: 4, wbb: 3 } as const;

/** true when a college side has played fewer games than the prior is worth (or its games are unknown); the pros never wait. */
export function heldForPrior(league: BasketballLeague, home: TeamRating, away: TeamRating): boolean {
    if (league !== 'mbb' && league !== 'wbb') return false;
    const n = PRIOR_GAMES[league];
    return !((home.games ?? 0) >= n && (away.games ?? 0) >= n);
}
