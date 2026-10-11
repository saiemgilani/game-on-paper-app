// The player-season types blazing-the-nets' lib reads (lib/data/players.ts without its parquet
// reader and index builder; the Data API's shot_season_players rows replace both, see adapters.ts).
import type { FieldGoals } from "./aggregate";

export interface PlayerStats {
  gp: number;
  /** Minutes PER GAME (advanced / totals row). */
  min: number | null;
  /** Season total FGA (advanced / totals row). */
  fga: number | null;
  fg_pct: number | null;
  efg_pct: number | null;
  ts_pct: number | null;
  usg_pct: number | null;
  pie: number | null;
  /** Points per game (base / pergame). */
  pts_pg: number | null;
  /** Field-goal attempts per game (base / pergame). */
  fga_pg: number | null;
  /** Total minutes (base / totals). */
  min_total: number | null;
}

export interface PlayerSeason extends FieldGoals {
  person_id: number;
  /** Full name from the season stats when available; the shots file only has the family name. */
  player_name: string;
  /** Team with the most attempts in the shots given (a traded player's primary team). */
  team_id: number;
  team_tricode: string;
  stats: PlayerStats | null;
  /**
   * "matching": `stats` cover the same games as attempts/makes. "all-teams": the player shot for
   * more than one team this season and the row is scoped to one team, so `stats` are his season
   * totals across teams (label them so) while attempts/makes are this team's only.
   */
  statsScope: "matching" | "all-teams";
}
