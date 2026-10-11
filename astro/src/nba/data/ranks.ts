import { lineOf } from "./aggregate";
import type { PlayerSeason } from "./players";

/** Where a player sits league-wide (Buckets-style rank lists). Higher is better for every metric. */

export const RANK_METRICS = ["fga", "fgPct", "efgPct", "fg3Pct", "tsPct"] as const;
export type RankMetric = (typeof RANK_METRICS)[number];

export const RANK_LABELS: Record<RankMetric, string> = {
  fga: "FGA",
  fgPct: "FG%",
  efgPct: "eFG%",
  fg3Pct: "3P%",
  tsPct: "TS%",
};

/** Eligible: this many field-goal attempts in the season's shots. */
export const RANK_MIN_FGA = 100;
/** 3P% also needs this many threes, or a centre's 2-for-3 leads the league. */
export const RANK_MIN_FG3A = 50;

/**
 * The metric from the season stats when present, else from shots. The stats row used
 * (regular-season advanced totals) has no 3P%, so 3P% is always from shots; TS% needs free
 * throws, so a player without a stats row has none.
 */
export function metricValue(p: PlayerSeason, metric: RankMetric): number | null {
  const line = lineOf(p);
  switch (metric) {
    case "fga":
      return p.stats?.fga ?? p.attempts;
    case "fgPct":
      return p.stats?.fg_pct ?? line.fgPct;
    case "efgPct":
      return p.stats?.efg_pct ?? line.efgPct;
    case "fg3Pct":
      return p.fg3a >= RANK_MIN_FG3A ? line.fg3Pct : null;
    case "tsPct":
      return p.stats?.ts_pct ?? null;
  }
}

export interface RankEntry {
  person_id: number;
  name: string;
  team: string;
  value: number;
  /** Competition ranking: 1 + the number of players strictly better (ties share a rank: 1, 2, 2, 4). */
  rank: number;
}

/** Every eligible player with a value, best first (ties by name). */
export function rankTable(players: PlayerSeason[], metric: RankMetric): RankEntry[] {
  const rows = players
    .filter((p) => p.attempts >= RANK_MIN_FGA)
    .map((p) => ({ person_id: p.person_id, name: p.player_name, team: p.team_tricode, value: metricValue(p, metric) }))
    .filter((r): r is Omit<RankEntry, "rank"> => r.value !== null)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.value !== rows[i - 1].value) rank = i + 1; // equal values keep the first one's rank
    return { ...r, rank };
  });
}

export interface RankSummary {
  metric: RankMetric;
  label: string;
  /** The player's row, or null when he is not eligible for this metric. */
  me: RankEntry | null;
  of: number;
  top: RankEntry[];
}

/** One summary per metric: his rank of N and the top five. */
export function rankSummaries(players: PlayerSeason[], personId: number, topN = 5): RankSummary[] {
  return RANK_METRICS.map((metric) => {
    const table = rankTable(players, metric);
    return {
      metric,
      label: RANK_LABELS[metric],
      me: table.find((r) => r.person_id === personId) ?? null,
      of: table.length,
      top: table.slice(0, topN),
    };
  });
}
