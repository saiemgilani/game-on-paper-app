// src/routes/nba/explorer.ts
import type { PlayerGame } from '../../nba/data/aggregate';
import type { ShotLite } from '../../nba/data/shots';
import type { LeagueContext } from '../../nba/dashboard';

/** What the player page's game filters need in the browser to rebuild the six charts. */
export interface PlayerExplorerData {
    shots: ShotLite[];
    /** Date-ordered games; null when the logs cannot place every game (the per-game views say so). */
    games: PlayerGame[] | null;
    league: LeagueContext;
    seasonFgPct: number | null;
}
