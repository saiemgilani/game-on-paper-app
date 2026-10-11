import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { pointer, select } from "d3-selection";
import { line } from "d3-shape";
import type { RollingPoint } from "../data/aggregate";
import { fmtDate, fmtPct } from "../format";
import { DEFAULT_WIDTH } from "./court";
import { drawNotes, FONT_PX, motionMs, setViewBox, TOKENS, wrapText } from "./theme";

/** Trailing N-game FG% and eFG% across the selected games, with his season FG% for reference. */

export interface RollingData {
  points: RollingPoint[];
  seasonFgPct: number | null;
  n: number;
}

const PLOT_H = 170;
const M = { top: 34, right: 12, left: 40 };

export const ROLLING_VIEWBOX = { width: DEFAULT_WIDTH, height: M.top + PLOT_H + 60 };

/** The y domain: the values and the season rate, padded 5 points, kept inside 0-100%. */
export function rollingDomain(points: RollingPoint[], seasonFgPct: number | null): [number, number] {
  const values = points.flatMap((p) => [p.fgPct, p.efgPct]).concat(seasonFgPct === null ? [] : [seasonFgPct]).filter((v): v is number => v !== null);
  const [lo, hi] = extent(values);
  if (lo === undefined || hi === undefined) return [0, 1];
  return [Math.max(0, Math.floor((lo - 0.05) * 20) / 20), Math.min(1, Math.ceil((hi + 0.05) * 20) / 20)];
}

export function describeRolling(data: RollingData): string {
  const last = data.points[data.points.length - 1];
  if (!last) return "No games selected.";
  return `Rolling ${data.n}-game shooting over ${data.points.length} games; latest window ${fmtPct(last.fgPct)} FG%, ${fmtPct(last.efgPct)} eFG%; season FG% ${fmtPct(data.seasonFgPct)}.`;
}

export function renderRollingChart(svg: SVGSVGElement, data: RollingData, { width, animate = true }: { width: number; animate?: boolean }): () => void {
  const W = width;
  const root = select(svg).append("g");
  const bottom = M.top + PLOT_H;
  const pts = data.points;
  const x = scaleLinear()
    .domain([0, Math.max(1, pts.length - 1)])
    .range([M.left, W - M.right]);
  const y = scaleLinear().domain(rollingDomain(pts, data.seasonFgPct)).range([bottom, M.top]);

  const axes = root.append("g").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted);
  const yTicks = y.ticks(4);
  axes
    .selectAll("line")
    .data(yTicks)
    .join("line")
    .attr("x1", M.left)
    .attr("x2", W - M.right)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d))
    .style("stroke", TOKENS.line);
  axes
    .selectAll("text.y")
    .data(yTicks)
    .join("text")
    .attr("class", "y")
    .attr("x", M.left - 6)
    .attr("y", (d) => y(d) + 4)
    .attr("text-anchor", "end")
    .text((d) => `${Math.round(d * 100)}%`);
  const xTicks = pts.length ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter((v, i, a) => a.indexOf(v) === i) : [];
  axes
    .selectAll("text.x")
    .data(xTicks)
    .join("text")
    .attr("class", "x")
    .attr("x", (i) => x(i))
    .attr("y", bottom + FONT_PX + 5)
    .attr("text-anchor", (i) => (i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"))
    .text((i) => fmtDate(pts[i].date));

  if (!pts.length) {
    root.append("text").attr("x", W / 2).attr("y", M.top + PLOT_H / 2).attr("text-anchor", "middle").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted).text("No games selected");
  }
  if (data.seasonFgPct !== null) {
    root
      .append("line")
      .attr("x1", M.left)
      .attr("x2", W - M.right)
      .attr("y1", y(data.seasonFgPct))
      .attr("y2", y(data.seasonFgPct))
      .style("stroke", TOKENS.muted)
      .style("stroke-dasharray", "3 3");
  }
  const series = [
    { key: "fgPct" as const, stroke: TOKENS.accent, dash: "none" },
    { key: "efgPct" as const, stroke: TOKENS.fg, dash: "6 3" },
  ];
  const paths = series.map((s) =>
    root
      .append("path")
      .datum(pts)
      .attr(
        "d",
        line<RollingPoint>()
          .defined((p) => p[s.key] !== null)
          .x((_, i) => x(i))
          .y((p) => y(p[s.key] ?? 0)),
      )
      .style("fill", "none")
      .style("stroke", s.stroke)
      .style("stroke-width", 2)
      .style("stroke-dasharray", s.dash),
  );
  const ms = animate ? motionMs(500) : 0;
  if (ms) for (const p of paths) p.style("opacity", 0).transition().duration(ms).style("opacity", 1);

  // Key above the plot; the cursor readout replaces it while hovering.
  const key = root.append("g").style("font-size", `${FONT_PX}px`);
  key.append("text").attr("x", M.left).attr("y", 14).style("fill", TOKENS.accent).text(`— ${data.n}-game FG%`);
  key.append("text").attr("x", M.left + 110).attr("y", 14).style("fill", TOKENS.fg).text("- - eFG%");
  key.append("text").attr("x", M.left + 170).attr("y", 14).style("fill", TOKENS.muted).text("··· season FG%");
  const readout = root.append("text").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.fg);
  const cursor = root.append("line").attr("y1", M.top).attr("y2", bottom).style("stroke", TOKENS.fg).style("stroke-opacity", 0.5).style("display", "none");
  root
    .append("rect")
    .attr("x", M.left)
    .attr("y", M.top)
    .attr("width", W - M.left - M.right)
    .attr("height", PLOT_H)
    .style("fill", "transparent")
    .on("pointermove", (event: PointerEvent) => {
      if (!pts.length) return;
      const [px] = pointer(event, root.node());
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(x.invert(px))));
      const p = pts[i];
      cursor.style("display", null).attr("x1", x(i)).attr("x2", x(i));
      key.style("display", "none");
      readout
        .selectAll("tspan")
        .data(wrapText(`${fmtDate(p.date)}: last ${p.games} games ${fmtPct(p.fgPct)} FG%, ${fmtPct(p.efgPct)} eFG% (${p.attempts} FGA)`, W - M.left - M.right).slice(0, 2))
        .join("tspan")
        .attr("x", M.left)
        .attr("y", (_, j) => 12 + j * 14)
        .text((d) => d);
    })
    .on("pointerleave", () => {
      cursor.style("display", "none");
      key.style("display", null);
      readout.selectAll("tspan").remove();
    });

  const notes = drawNotes(root, M.left, bottom + FONT_PX + 12, W - M.left - M.right, [
    `each point pools the attempts of the ${data.n} games ending there (fewer at the start)`,
  ]);
  setViewBox(svg, W, bottom + FONT_PX + 12 + notes + 4);
  return () => {
    for (const p of paths) p.interrupt();
    root.remove();
  };
}
