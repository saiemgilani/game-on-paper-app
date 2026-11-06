// One game's field-goal attempts on the half court: filled circles made, crosses missed.
import { select } from "d3-selection";
import { COURT, toSvg, type Viewport } from "../data/court";
import { COURT_PAD, COURT_TOP, courtViewport, DEFAULT_WIDTH, drawCourt } from "./court";
import { setViewBox, TOKENS, type G } from "./theme";
import type { Court } from "../../basketball/config";
import { placeholderNote } from "../data/placeholder";

export interface GameShot { x: number; y: number; made: boolean; value: number; label: string; period: number; unlocated?: true }
export interface ShotMark { cx: number; cy: number; made: boolean; value: number; label: string }
export const GAME_SHOT_VIEWBOX = { width: DEFAULT_WIDTH, height: courtViewport().height };
const R = 4.5;

export function shotMarks(shots: GameShot[], v: Viewport): ShotMark[] {
  return shots.map((s) => {
    const p = toSvg({ x: s.x, y: s.y }, v);
    return { cx: p.x, cy: p.y, made: s.made, value: s.value, label: s.label };
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
  g.append("g").attr("class", "made").selectAll("circle").data(marks.filter((m) => m.made)).join("circle")
    .attr("cx", (m) => m.cx).attr("cy", (m) => m.cy).attr("r", R).attr("fill", TOKENS.accent).attr("fill-opacity", 0.75)
    .append("title").text((m) => m.label);
  g.append("g").attr("class", "missed").selectAll("path").data(marks.filter((m) => !m.made)).join("path")
    .attr("d", (m) => `M${m.cx - R},${m.cy - R}L${m.cx + R},${m.cy + R}M${m.cx - R},${m.cy + R}L${m.cx + R},${m.cy - R}`)
    .attr("stroke", TOKENS.muted).attr("stroke-width", 1.5).attr("fill", "none")
    .append("title").text((m) => m.label);
  // the summary lives in <desc> and the caption under the chart, not on the court
  return () => { root.selectAll("*").remove(); };
}
