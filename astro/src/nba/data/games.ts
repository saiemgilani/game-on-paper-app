import type { GameLogRow } from "./shots";

/** Per-game context, pure (no release reads) so the browser can use it too. */

/** One team's view of one game. */
export interface GameInfo {
  game_id: string;
  date: string;
  team_id: number;
  opponent_id: number;
  opponent: string;
  /**
   * "home" when the matchup reads "vs.", "away" for "@", "neutral" when both of the game's rows use
   * "@" (NBA Cup finals, international games): neither side is at home.
   */
  venue: Venue;
  win: boolean | null;
}

export type Venue = "home" | "away" | "neutral";

export const gameKey = (gameId: string, teamId: number) => `${gameId}:${teamId}`;

/** (game_id, team_id) -> that team's game, with the opponent taken from the game's other row. */
export function teamGames(rows: GameLogRow[]): Map<string, GameInfo> {
  const byGame = new Map<string, GameLogRow[]>();
  for (const r of rows) byGame.set(r.game_id, [...(byGame.get(r.game_id) ?? []), r]);
  const out = new Map<string, GameInfo>();
  for (const [gameId, pair] of byGame) {
    // ponytail: a half-logged game has no opponent and is left out. For a player who shot in it,
    // playerGames then throws ("no game log"), which the player page turns into "per-game views
    // unavailable" for that season rather than a chart missing one game.
    if (pair.length !== 2) continue;
    const neutral = pair.every((r) => !r.matchup.includes(" vs. "));
    for (const [me, them] of [pair, [pair[1], pair[0]]]) {
      out.set(gameKey(gameId, me.team_id), {
        game_id: gameId,
        date: me.game_date,
        team_id: me.team_id,
        opponent_id: them.team_id,
        opponent: them.team_abbreviation,
        venue: neutral ? "neutral" : me.matchup.includes(" vs. ") ? "home" : "away",
        win: me.wl === null ? null : me.wl === "W",
      });
    }
  }
  return out;
}
