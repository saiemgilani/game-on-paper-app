/**
 * IF-6: the "first time this final score happened" chip on a final game page.
 *
 * The population is the Data API schedule table (`cfb.schedule` / `nfl.espn_schedule`),
 * completed games only, and for CFB only FBS vs FBS (`fbs_game`). Checked 2026-11-01:
 * CFB FBS vs FBS rows are complete from 2001 (650-800 a season) and NFL regular season +
 * playoffs from 1999 (259-285 a season, no Pro Bowl), so the label states that span.
 */
import type { League } from './league';

// ponytail: the span's start years are fixed, not read from the table. Data reaching
// further back only makes "first since <year>" a stronger statement, never a false one;
// a table that started LATER would need these raised.
export const FIRST_FINAL_SPAN: Partial<Record<League, string>> = {
    cfb: 'FBS vs FBS games since 2001',
    nfl: 'since 1999',
};

export interface FinalScoreRow {
    game_id: number | string;
    start_date: string;
}

/** Winner's points first; a tie is (score, score). */
export function finalScore(a: number, b: number): [number, number] {
    return a >= b ? [a, b] : [b, a];
}

/** The earliest row of the per-orientation lookups (home/away swapped), or null. */
export function earliestFinal(rows: FinalScoreRow[]): FinalScoreRow | null {
    return rows.reduce<FinalScoreRow | null>((best, r) => (!best || r.start_date < best.start_date ? r : best), null);
}

/**
 * True only when this game IS the earliest completed game in the population with this
 * final. Game ids compare as strings: the table's are numbers, ESPN's header id a string.
 * A game not yet in the table (or not in the population, e.g. FBS vs FCS) is never first.
 */
export function finalScoreFirst(earliest: FinalScoreRow | null, gameId: string | number): boolean {
    return earliest != null && String(earliest.game_id) === String(gameId);
}

/** "First 56-22 final (FBS vs FBS games since 2001)" */
export function firstFinalLabel(league: League, a: number, b: number): string | null {
    const span = FIRST_FINAL_SPAN[league];
    if (!span) return null;
    const [w, l] = finalScore(a, b);
    return `First ${w}-${l} final (${span})`;
}
