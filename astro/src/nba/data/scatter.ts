import { SCATTER_METRICS, type ScatterMetric, type ScatterPoint } from "../scatterMetrics";
import { lineOf } from "./aggregate";
import type { PlayerSeason } from "./players";
import { RANK_MIN, type RankMins } from "./ranks";
import { teamById } from "./teams";

/**
 * Season stats where the release has them, shots otherwise: FG%, eFG% and 3P% fall back to the
 * shots; per-game, minutes, TS% and USG% need the stats row. 3P% needs the league-season's 3PA bar (the rank rule).
 */
export function scatterValues(p: PlayerSeason, min: RankMins = RANK_MIN): Record<ScatterMetric, number | null> {
  const line = lineOf(p);
  const s = p.stats;
  return {
    ptsPg: s?.pts_pg ?? null,
    fgaPg: s?.fga_pg ?? null,
    min: s?.min ?? null,
    fgPct: s?.fg_pct ?? line.fgPct,
    efgPct: s?.efg_pct ?? line.efgPct,
    fg3Pct: p.fg3a >= min.fg3a ? line.fg3Pct : null,
    tsPct: s?.ts_pct ?? null,
    usgPct: s?.usg_pct ?? null,
  };
}

/** Every player at the league-season's FGA bar in the season's shots, as a scatter point; `highlightTeamId` null highlights no one. */
export function scatterPoints(
  players: PlayerSeason[],
  headshots: ReadonlyMap<number, string>,
  highlightTeamId: number | null,
  { colorOf = (id: number) => teamById(id)?.color, min = RANK_MIN }: { colorOf?: (teamId: number) => string | undefined; min?: RankMins } = {},
): ScatterPoint[] {
  return players
    .filter((p) => p.attempts >= min.fga)
    .map((p) => {
      const values = scatterValues(p, min);
      return {
        person_id: p.person_id,
        name: p.player_name,
        team_id: p.team_id,
        team: p.team_tricode,
        color: colorOf(p.team_id) ?? "#888888",
        nets: p.team_id === highlightTeamId,
        headshot: headshots.get(p.person_id) ?? null,
        // 4 decimals is finer than any axis can show and keeps the payload small.
        v: SCATTER_METRICS.map((m) => (values[m] === null ? null : Math.round(values[m] * 1e4) / 1e4)),
      };
    });
}
