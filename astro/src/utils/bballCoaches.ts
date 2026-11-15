/**
 * Head-coach boards for the NBA and the WNBA (BB-G9, behind 'bball-coaches'): the football boards' layout
 * (utils/coaches.ts) on sdv-db's `coach_seasons` / `coach_careers` (sdv-db #196, sdv-py nba_coach_seasons #1109).
 *
 * Every rate, rank and percentile is the producer's (rule B6): `<m>_rank` is 1 = best in the metric's own direction
 * (DRtg, TOV% and the defensive factors rank low-first), `<m>_pct` is 0-100 among the same cohort, and a row outside
 * the cohort (a coach-season under half the most games any team played; a career under one full season) has a null
 * rank. The page sorts and formats; it never ranks. The college tables wait on an NCAA coach release, so mbb/wbb have
 * no boards.
 */
import type { CoachBoard, CoachBoardColumn, CoachRow } from './coaches';
import { numericValue, sortCoachRows } from './coaches';

export type BballCoachLeague = 'nba' | 'wnba';

/** The first season the coach tables hold, both leagues (measured on the Data API, 2026-11-05: 1997 has no rows). */
export const BBALL_COACH_FIRST_SEASON = 1998;

/**
 * The coverage notice. A team-season whose coach of record no single placement fits is left out, not guessed (sdv-py
 * #1109): against Basketball-Reference for 2016-2026, 77% of NBA and 55% of WNBA regular-season games are credited
 * (sdv-db #196). The share is the producer's measurement, quoted, not computed here.
 */
export const BBALL_COACH_UNCREDITED: Record<BballCoachLeague, string> = {
    nba: 'about 23%',
    wnba: 'about 45%',
};

const col = (key: string, label: string, hover: string, format: CoachBoardColumn['format'], lowerIsBetter = false): CoachBoardColumn => ({ key, label, hover, format, lowerIsBetter });

export const BBALL_COACH_BOARDS: Record<string, CoachBoard> = {
    ratings: {
        slug: 'ratings',
        title: 'Ratings',
        defaultSort: 'net_rtg',
        columns: [
            col('win_pct', 'Win%', 'Share of the games coached that were won', 'pct'),
            col('net_rtg', 'Net', 'Net rating: offensive minus defensive rating, points per 100 possessions', 'num1'),
            col('off_rtg', 'ORtg', 'Offensive rating: points scored per 100 possessions', 'num1'),
            col('def_rtg', 'DRtg', 'Defensive rating: points allowed per 100 possessions; lower is better', 'num1', true),
            // fast is not better: ranked, never shaded
            { ...col('pace', 'Pace', 'Possessions per 48 minutes (40 in the WNBA)', 'num1'), neutral: true },
        ],
    },
    'four-factors': {
        slug: 'four-factors',
        title: 'Four Factors',
        defaultSort: 'efg_pct',
        columns: [
            col('efg_pct', 'eFG%', 'Effective field-goal percentage: (FGM + 0.5 × 3PM) / FGA', 'pct'),
            col('tov_pct', 'TOV%', 'Turnovers per possession; lower is better', 'pct', true),
            col('orb_pct', 'ORB%', 'Offensive rebounds over offensive-rebound chances', 'pct'),
            col('ft_rate', 'FT Rate', 'Free-throw attempts per field-goal attempt', 'num2'),
            col('opp_efg_pct', 'Opp eFG%', 'Opponent effective field-goal percentage; lower is better', 'pct', true),
            col('opp_tov_pct', 'Opp TOV%', 'Opponent turnovers per possession', 'pct'),
            col('opp_orb_pct', 'Opp ORB%', 'Opponent offensive rebounds over their chances; lower is better', 'pct', true),
            col('opp_ft_rate', 'Opp FT Rate', 'Opponent free-throw attempts per field-goal attempt; lower is better', 'num2', true),
        ],
    },
};
export const BBALL_COACH_BOARD_SLUGS = Object.keys(BBALL_COACH_BOARDS);
export const DEFAULT_BBALL_COACH_BOARD = 'ratings';

/** The board for `?board=`, else the default: an own-key lookup, so 'toString' is not a board. */
export function bballCoachBoard(board: string | null | undefined): CoachBoard {
    return board && Object.hasOwn(BBALL_COACH_BOARDS, board) ? BBALL_COACH_BOARDS[board] : BBALL_COACH_BOARDS[DEFAULT_BBALL_COACH_BOARD];
}

/** The sort column: `?sort=` when the board has it, else the board's default. */
export function bballCoachSort(board: CoachBoard, sort: string | null | undefined): CoachBoardColumn {
    return board.columns.find((c) => c.key === sort) ?? board.columns.find((c) => c.key === board.defaultSort)!;
}

/** Every column the boards read, once: the `select` (each metric with its producer rank and percentile). */
export function bballCoachSelect(careers: boolean): string {
    const ids = careers
        ? ['coach_id', 'coach', 'teams', 'seasons', 'first_season', 'last_season']
        : ['season', 'team_id', 'team', 'coach_id', 'coach', 'team_games'];
    const metrics = [...new Set(Object.values(BBALL_COACH_BOARDS).flatMap((b) => b.columns.map((c) => c.key)))];
    return [...ids, 'games', 'wins', 'losses', 'pbp_games', ...metrics.flatMap((m) => [m, `${m}_rank`, `${m}_pct`])].join(',');
}

/**
 * The rows in board order: the producer's cohort (a non-null `win_pct_rank`; every row has a W-L) first, sorted by the
 * column, then the rest below a divider, unranked, as football's partial seasons.
 */
export function splitBballCoachRows<T extends CoachRow>(rows: T[], column: CoachBoardColumn): { qualified: T[]; partial: T[] } {
    const sorted = sortCoachRows(rows, column);
    return {
        qualified: sorted.filter((r) => numericValue(r, 'win_pct_rank') !== null),
        partial: sorted.filter((r) => numericValue(r, 'win_pct_rank') === null),
    };
}
