/** The read behind BB-G43's Lines and markets panel ('bball-lines'): the game's one `{lg}.game_lines` row (BB-D33, sdv-db #216). */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';
import { LINES_FROM, type GameLine } from '../utils/gameLines';

/** The nightly's window: an unplayed game's latest quote and an unmapped game's missing row both move with it. */
const TTL = 6 * 60 * 60;
const YEAR = 60 * 60 * 24 * 365;

/** A finished game's settled row (its results are in) never changes. */
export const settled = (l: GameLine | null) => l?.ats_result != null;

/** The row, or null when the game has none (an unmapped game, or a season before the odds files); strict, so a failed read throws. */
export async function retrieveGameLine(league: BasketballLeague, season: number | null, gameId: string): Promise<GameLine | null> {
    if (season == null || season < LINES_FROM[league]) return null;
    const rows = await retrieveRowsFrom<GameLine>(BASKETBALL[league].gamesSource, 'game_lines', { season: String(season), game_id: gameId, limit: '2' },
        (c: any) => (settled(c?.data?.[0] ?? null) ? YEAR : TTL), true, NBA_READ_TIMEOUT_MS);
    return rows[0] ?? null;
}
