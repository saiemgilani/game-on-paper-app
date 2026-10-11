// One game's field-goal attempts on the half court: filled circles made, crosses missed.
import { select } from "d3-selection";
import { toSvg, type Viewport } from "../data/court";
import { courtViewport, DEFAULT_WIDTH, drawCourt } from "./court";
import { FONT_PX, setViewBox, TOKENS, type G } from "./theme";

export interface GameShot { x: number; y: number; made: boolean; value: number; label: string; period: number }
export interface ShotMark { cx: number; cy: number; made: boolean; value: number; label: string }
export const GAME_SHOT_VIEWBOX = { width: DEFAULT_WIDTH, height: courtViewport().height };
const R = 4.5;

export function shotMarks(shots: GameShot[], v: Viewport): ShotMark[] {
  return shots.map((s) => {
    const p = toSvg({ x: s.x, y: s.y }, v);
    return { cx: p.x, cy: p.y, made: s.made, value: s.value, label: s.label };
  });
}

export function describeShots(shots: GameShot[]): string {
  const threes = shots.filter((s) => s.value === 3);
  return `${shots.filter((s) => s.made).length} of ${shots.length} field goals made, ${threes.filter((s) => s.made).length} of ${threes.length} threes`;
}

export function renderGameShotChart(svg: SVGSVGElement, shots: GameShot[], { width }: { width: number }): () => void {
  const v = courtViewport(width);
  const root = select(svg);
  root.selectAll("*").remove();
  setViewBox(svg, width, v.height);
  const g = root.append("g") as unknown as G;
  drawCourt(g, v);
  const marks = shotMarks(shots, v);
  g.append("g").attr("class", "made").selectAll("circle").data(marks.filter((m) => m.made)).join("circle")
    .attr("cx", (m) => m.cx).attr("cy", (m) => m.cy).attr("r", R).attr("fill", TOKENS.accent).attr("fill-opacity", 0.75)
    .append("title").text((m) => m.label);
  g.append("g").attr("class", "missed").selectAll("path").data(marks.filter((m) => !m.made)).join("path")
    .attr("d", (m) => `M${m.cx - R},${m.cy - R}L${m.cx + R},${m.cy + R}M${m.cx - R},${m.cy + R}L${m.cx + R},${m.cy - R}`)
    .attr("stroke", TOKENS.muted).attr("stroke-width", 1.5).attr("fill", "none")
    .append("title").text((m) => m.label);
  g.append("text").attr("x", 8).attr("y", FONT_PX + 4).attr("font-size", FONT_PX).attr("fill", TOKENS.fg).text(describeShots(shots));
  return () => { root.selectAll("*").remove(); };
}
