// src/routes/nba/explorer.ts
import type { Court } from '../../basketball/config';
import type { PlayerGame } from '../../nba/data/aggregate';
import type { ShotLite } from '../../nba/data/shots';
import type { LeagueContext } from '../../nba/dashboard';
import type { PlaceholderLocation } from '../../nba/data/placeholder';

/** What the player page's game filters need in the browser to rebuild the six charts. */
export interface PlayerExplorerData {
    shots: ShotLite[];
    /** Date-ordered games; null when the logs cannot place every game (the per-game views say so). */
    games: PlayerGame[] | null;
    league: LeagueContext;
    seasonFgPct: number | null;
    /** The season's court when it is not the NBA's (absent for the NBA, so its island props do not change). */
    court?: Court;
    /** D29: the league's placeholder location (absent for the NBA); the island leaves those shots out of its charts. */
    placeholder?: PlaceholderLocation;
}
