/**
 * The Data API read behind the league hub's market line (BB-G47, behind 'bball-hub'): `{league}.game_lines` (BB-D33), one row
 * per ESPN game with the books' median spread, total, moneylines and the no-vig market win probability. Lenient: a failed or
 * missing read is a card with no line, never a hub that does not render (the current season is only partly mapped).
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';

export interface GameLineRow {
    game_id: number | string;
    n_books: number | null;
    spread_home_open: number | null; spread_home_close: number | null;
    total_open: number | null; total_close: number | null;
    market_home_wp_open: number | null; market_home_wp_close: number | null;
    ats_result: 'home' | 'away' | 'push' | null;
}

/** Lines move once a night (the nightly build); the read's cache key also carries the table's ingest stamp. */
const TTL = 6 * 60 * 60;
const SELECT = 'game_id,n_books,spread_home_open,spread_home_close,total_open,total_close,market_home_wp_open,market_home_wp_close,ats_result';
// ponytail: one read per game (the API has no IN filter, and a college day's ESPN ids are not contiguous); a board past this
// many games (an all-D-I fallback day) gets lines on its first cards only. A ranged or batched read if that matters.
export const MAX_LINE_READS = 40;

/** ESPN game id -> its game_lines row, for the games that have one. */
export async function retrieveGameLines(league: BasketballLeague, games: readonly { id: string; season: number }[]): Promise<Map<string, GameLineRow>> {
    const src = BASKETBALL[league].gamesSource;
    const rows = await Promise.all(games.slice(0, MAX_LINE_READS).map(({ id, season }) =>
        retrieveRowsFrom<GameLineRow>(src, 'game_lines', { season: String(season), game_id: id, select: SELECT, limit: '1' }, TTL, false, NBA_READ_TIMEOUT_MS)
            .catch(() => [] as GameLineRow[])));
    return new Map(rows.flat().map((r) => [String(r.game_id), r]));
}
