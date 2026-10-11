// The shot types blazing-the-nets' lib reads (lib/data/shots.ts without its parquet reader).
// `x_legacy`/`y_legacy` are tenths of a foot, hoop at the origin, y growing toward half court.
export interface Shot {
  game_id: string;
  period: number;
  clock: string;
  team_id: number;
  team_tricode: string;
  person_id: number;
  player_name: string;
  sub_type: string;
  shot_result: "Made" | "Missed";
  shot_value: number;
  shot_distance: number;
  x_legacy: number;
  y_legacy: number;
}

/** The fields the aggregations read; what the player page ships to the browser for re-filtering. */
export type ShotLite = Pick<Shot, "game_id" | "x_legacy" | "y_legacy" | "shot_distance" | "shot_value" | "shot_result">;

export function toLite(s: Shot): ShotLite {
  const { game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result } = s;
  return { game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result };
}

/** One row per TEAM per game of `nba_stats.player_game_logs` (two rows per game_id). */
export interface GameLogRow {
  game_id: string;
  team_id: number;
  team_abbreviation: string;
  game_date: string;
  matchup: string;
  wl: "W" | "L" | null;
}
