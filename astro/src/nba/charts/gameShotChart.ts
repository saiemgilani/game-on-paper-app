// One game's field-goal attempts on the half court: filled circles made, crosses missed.
import { select } from "d3-selection";
import { COURT, toSvg, toSvgLength, type Viewport } from "../data/court";
import { COURT_PAD, COURT_TOP, courtViewport, DEFAULT_WIDTH, drawCourt } from "./court";
import { setViewBox, TOKENS, type G } from "./theme";
import type { Court } from "../../basketball/config";
import { placeholderNote } from "../data/placeholder";
import { emitDistance, onDistance } from "./link";
import type { ShotLite } from "../data/shots";

export interface GameShot { x: number; y: number; made: boolean; value: number; label: string; period: number; unlocated?: true }
export interface ShotMark { cx: number; cy: number; made: boolean; value: number; label: string; ft: number }
export const GAME_SHOT_VIEWBOX = { width: DEFAULT_WIDTH, height: courtViewport().height };
const R = 4.5;
/** Opacity of a shot outside the distance another chart in the same `data-shot-link` dashboard marks. */
const DIM = 0.12;

/** Rounded feet from the rim, as the dashboards' shot_distance (sdv-db: floor(hypot / 10 + 0.5)). */
export const shotFeet = (s: Pick<GameShot, "x" | "y">): number => Math.round(Math.hypot(s.x, s.y) / 10);

/** BB-G39: a game's located shots as the dashboards' ShotLite, so fgPctByDistance bins them like the league's. */
export function gameShotsLite(shots: GameShot[], gameId: string): ShotLite[] {
  return shots.filter((s) => !s.unlocated).map((s) => ({
    game_id: gameId, x_legacy: s.x, y_legacy: s.y, shot_distance: shotFeet(s), shot_value: s.value, shot_result: s.made ? "Made" : "Missed",
  }));
}

export function shotMarks(shots: GameShot[], v: Viewport): ShotMark[] {
  return shots.map((s) => {
    const p = toSvg({ x: s.x, y: s.y }, v);
    return { cx: p.x, cy: p.y, made: s.made, value: s.value, label: s.label, ft: shotFeet(s) };
  });
}

/** The court is drawn from the baseline to COURT_TOP; a heave from past it (or off the sideline) has no place on it. */
// `shots.filter(onDrawnCourt)` passes the array index as `court` (hence `| number`): anything but a court object means COURT.
export function onDrawnCourt(s: GameShot, court?: Court | number): boolean {
  const c = typeof court === "object" && court !== null ? court : COURT;
  return !s.unlocated && s.y <= COURT_TOP && s.y >= c.baselineY - COURT_PAD && Math.abs(s.x) <= c.halfWidth + COURT_PAD;
}

export function describeShots(shots: GameShot[], court: Court = COURT): string {
  const threes = shots.filter((s) => s.value === 3);
  const none = shots.filter((s) => s.unlocated).length;
  const off = shots.filter((s) => !s.unlocated && !onDrawnCourt(s, court)).length;
  return `${shots.filter((s) => s.made).length} of ${shots.length} field goals made, ${threes.filter((s) => s.made).length} of ${threes.length} threes${off ? `; ${off} from beyond the drawn court not shown` : ''}${none ? `; ${placeholderNote(none, shots.length, 'game')}` : ''}`;
}

export function renderGameShotChart(svg: SVGSVGElement, shots: GameShot[], { width, court = COURT }: { width: number; court?: Court }): () => void {
  const v = courtViewport(width);
  const root = select(svg);
  root.selectAll("*").remove();
  setViewBox(svg, width, v.height);
  const g = root.append("g") as unknown as G;
  drawCourt(g, v, { court });
  const marks = shotMarks(shots.filter((s) => onDrawnCourt(s, court)), v);
  const made = g.append("g").attr("class", "made").selectAll("circle").data(marks.filter((m) => m.made)).join("circle")
    .attr("cx", (m) => m.cx).attr("cy", (m) => m.cy).attr("r", R).attr("fill", TOKENS.accent).attr("fill-opacity", 0.75);
  made.append("title").text((m) => m.label);
  const missed = g.append("g").attr("class", "missed").selectAll("path").data(marks.filter((m) => !m.made)).join("path")
    .attr("d", (m) => `M${m.cx - R},${m.cy - R}L${m.cx + R},${m.cy + R}M${m.cx - R},${m.cy + R}L${m.cx + R},${m.cy - R}`)
    .attr("stroke", TOKENS.muted).attr("stroke-width", 1.5).attr("fill", "none");
  missed.append("title").text((m) => m.label);
  const rim = toSvg({ x: 0, y: 0 }, v);
  const ring = g.append("circle").attr("cx", rim.x).attr("cy", rim.y).attr("pointer-events", "none").attr("fill", "none")
    .attr("stroke", TOKENS.fg).attr("stroke-opacity", 0.55).attr("stroke-width", 2).attr("stroke-dasharray", "5 4").style("display", "none");
  // ... and another chart's distance rings the rim at it and dims the shots outside it
  const unlink = onDistance(svg, ({ ft, band = 1 }) => {
    ring.style("display", ft === null ? "none" : "inline").attr("r", ft === null ? 0 : toSvgLength(ft * 10, v));
    // a bin's cursor is its centre and half its width (link.ts binCursor): a shot is in it when its rounded feet are
    const out = (m: ShotMark) => (ft !== null && Math.abs(m.ft - ft) >= band ? DIM : null);
    made.style("opacity", out);
    missed.style("opacity", out);
  });
  // BB-G39: inside a `data-shot-link` dashboard (no-ops outside one), a hovered shot sends its distance to the other charts
  const enter = (_e: PointerEvent, m: ShotMark) => emitDistance(svg, { ft: m.ft, band: 0.5 });
  const leave = () => emitDistance(svg, { ft: null });
  made.on("pointerenter", enter).on("pointerleave", leave);
  missed.on("pointerenter", enter).on("pointerleave", leave);
  // the summary lives in <desc> and the caption under the chart, not on the court
  return () => { unlink(); root.selectAll("*").remove(); };
}
