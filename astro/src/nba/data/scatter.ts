import { IMPACT_COLUMNS, IMPACT_METRICS, SCATTER_METRICS, TEAM_COLUMNS, TEAM_METRICS, type ScatterMetric, type ScatterPoint } from "../scatterMetrics";
import type { Team } from "./teams";
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

/** A producer cell as a 4-decimal number; null for a missing or non-numeric one (the Data API may send a number as text). */
function cell(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : null;
}

/**
 * BB-G10's player view: the shooting points with each player's `player_impact` values appended (AXIS_METRICS order). The
 * impact axes have their own bar (Q30): a player under `minOffPoss` offensive possessions, or with no impact row, has nulls
 * there and drops out of an impact plot only.
 * ponytail: built on the FGA-bar points, so a player over the possessions bar but under the FGA bar would be missing; none
 * is in 2025-26 (NBA 2,000 / WNBA 800: every one has 100+ / 54+ FGA). Add the shots' sub-bar players if one ever is.
 */
export function withImpact(points: ScatterPoint[], rows: readonly Record<string, unknown>[], minOffPoss: number): ScatterPoint[] {
  const byId = new Map(rows.filter((r) => (cell(r.off_poss) ?? 0) >= minOffPoss).map((r) => [Number(r.player_id), r]));
  return points.map((p) => {
    const r = byId.get(p.person_id);
    return { ...p, v: [...p.v, ...IMPACT_METRICS.map((m) => (r ? cell(r[IMPACT_COLUMNS[m]]) : null))] };
  });
}

/**
 * BB-G10's team view: one point per `team_strength` row whose team the league knows that season, its values in the team
 * slots of AXIS_METRICS (the player slots null). `person_id` carries the team id (the name picker's key).
 */
export function teamPoints(
  rows: readonly Record<string, unknown>[],
  teamOf: (teamId: number) => Team | undefined,
  highlightTeamId: number | null,
  logoOf: (team: Team) => string | null,
): ScatterPoint[] {
  const blank = Array<null>(SCATTER_METRICS.length + IMPACT_METRICS.length).fill(null);
  return rows.flatMap((r) => {
    const id = Number(r.team_id);
    const t = teamOf(id);
    if (!t) return [];
    return [{ person_id: id, name: t.name, team_id: id, team: t.tricode, color: t.color, nets: id === highlightTeamId, headshot: logoOf(t), v: [...blank, ...TEAM_METRICS.map((m) => cell(r[TEAM_COLUMNS[m]]))] }];
  });
}
