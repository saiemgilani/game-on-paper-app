/** The read behind BB-G45's WP lenses ('bball-wp-lenses'): a final's two per-play WP variants on `{lg}.play_wp` (sdv-db #217). */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';
import type { WpLensRow } from '../utils/wpLenses';

/** A season the nightly has not rebuilt since sdv-db #217 reads null in both columns: re-read on its window. */
const TTL = 6 * 60 * 60;
const YEAR = 60 * 60 * 24 * 365;
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Built: at least one play has the naive variant (every scored game has it; the market one needs a line). */
export const built = (rows: readonly WpLensRow[]) => rows.some((r) => r.naive != null);

/** The game's variant rows in play order; empty for a game play_wp does not hold. Strict: a failed read throws. */
export async function retrieveWpLenses(league: BasketballLeague, season: number, gameId: string): Promise<WpLensRow[]> {
    const rows = await retrieveRowsFrom<Record<string, unknown>>(BASKETBALL[league].gamesSource, 'play_wp',
        { season: String(season), game_id: gameId, select: 'game_play_number,home_win_prob_naive,home_win_prob_market', order: 'game_play_number', limit: '5000' },
        (c: any) => (Array.isArray(c?.data) && c.data.some((r: any) => r?.home_win_prob_naive != null) ? YEAR : TTL), true, NBA_READ_TIMEOUT_MS);
    return rows.map((r) => ({ n: num(r.game_play_number) ?? 0, naive: num(r.home_win_prob_naive), market: num(r.home_win_prob_market) }));
}
