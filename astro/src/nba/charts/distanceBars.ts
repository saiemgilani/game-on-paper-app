import { max } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import type { DistanceBin } from "../data/aggregate";
import { DEFAULT_WIDTH } from "./court";
import { fmtPct } from "../format";
import { CHAR_PX, FONT_PX, motionMs, setViewBox, tooltip, TOKENS } from "./theme";

export type BarMetric = "share" | "fgPct";

/** `fgPctByDistance` for the player and for the league, same `binFt`. */
export interface DistanceBarsData {
  player: DistanceBin[];
  league: DistanceBin[];
  binFt: number;
}

const H = 250;
const M = { top: 26, right: 8, bottom: 38, left: 40 };

export const DISTANCE_BARS_VIEWBOX = { width: DEFAULT_WIDTH, height: H };

export interface Bar {
  who: "player" | "league";
  x: number;
  width: number;
  y: number;
  height: number;
  value: number | null;
}

export interface BarGroup {
  label: string;
  /** Whether this group's label is printed (every n-th, so labels never collide). */
  showLabel: boolean;
  x: number;
  width: number;
  bars: [Bar, Bar];
  player: DistanceBin;
  league: DistanceBin;
}

const valueOf = (b: DistanceBin, metric: BarMetric) => (metric === "share" ? b.share : b.fgPct);

/** Grouped player/league bars per distance bin; FG% runs 0-100%, shares 0 to the largest share. */
export function barLayout(data: DistanceBarsData, metric: BarMetric, width: number = DEFAULT_WIDTH): { groups: BarGroup[]; yMax: number } {
  if (data.player.length !== data.league.length) throw new Error("barLayout: player and league bins differ");
  const yMax = metric === "fgPct" ? 1 : (max([...data.player, ...data.league], (b) => b.share) ?? 0) * 1.1 || 0.1;
  const x = scaleBand<number>()
    .domain(data.player.map((_, i) => i))
    .range([M.left, width - M.right])
    .paddingInner(0.2);
  const inner = scaleBand<"player" | "league">().domain(["player", "league"]).range([0, x.bandwidth()]).padding(0.05);
  const y = scaleLinear().domain([0, yMax]).range([H - M.bottom, M.top]).clamp(true);
  const label = (lo: number) => (data.binFt === 1 ? `${lo}` : `${lo}-${lo + data.binFt - 1}`);
  const longest = Math.max(...data.player.map((b) => label(b.distance).length));
  const every = Math.max(1, Math.ceil((longest * CHAR_PX + 8) / x.step()));
  const groups = data.player.map((player, i): BarGroup => {
    const league = data.league[i];
    const bar = (who: "player" | "league", b: DistanceBin): Bar => {
      const value = valueOf(b, metric);
      const top = y(value ?? 0);
      return { who, x: (x(i) ?? 0) + (inner(who) ?? 0), width: inner.bandwidth(), y: top, height: H - M.bottom - top, value };
    };
    return {
      label: label(player.distance),
      showLabel: i % every === 0,
      x: x(i) ?? 0,
      width: x.bandwidth(),
      bars: [bar("player", player), bar("league", league)],
      player,
      league,
    };
  });
  return { groups, yMax };
}

export function renderDistanceBars(
  svg: SVGSVGElement,
  data: DistanceBarsData,
  { metric, width: W, subjectLabel = "Player", animate = true }: { metric: BarMetric; width: number; subjectLabel?: string; animate?: boolean },
): () => void {
  const root = select(svg).append("g");
  const { groups, yMax } = barLayout(data, metric, W);
  const y = scaleLinear().domain([0, yMax]).range([H - M.bottom, M.top]);

  const axes = root.append("g").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted);
  const ticks = y.ticks(4);
  axes
    .selectAll("line")
    .data(ticks)
    .join("line")
    .attr("x1", M.left)
    .attr("x2", W - M.right)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d))
    .style("stroke", TOKENS.line);
  axes
    .selectAll("text.y")
    .data(ticks)
    .join("text")
    .attr("class", "y")
    .attr("x", M.left - 6)
    .attr("y", (d) => y(d) + 4)
    .attr("text-anchor", "end")
    .text((d) => `${Math.round(d * 100)}%`);
  axes
    .selectAll("text.x")
    .data(groups.filter((g) => g.showLabel))
    .join("text")
    .attr("class", "x")
    .attr("x", (g) => g.x + g.width / 2)
    .attr("y", H - M.bottom + FONT_PX + 4)
    .attr("text-anchor", "middle")
    .text((g) => g.label);
  axes
    .append("text")
    .attr("x", (M.left + W - M.right) / 2)
    .attr("y", H - 4)
    .attr("text-anchor", "middle")
    .text("shot distance (ft)");

  const legend = root.append("g").attr("transform", `translate(${W - M.right - 132},10)`).style("font-size", `${FONT_PX}px`);
  (["player", "league"] as const).forEach((who, i) => {
    legend
      .append("rect")
      .attr("x", i * 68)
      .attr("y", -8)
      .attr("width", 10)
      .attr("height", 10)
      .style("fill", who === "player" ? TOKENS.accent : TOKENS.muted)
      .style("fill-opacity", who === "player" ? 1 : 0.55);
    legend.append("text").attr("x", i * 68 + 14).attr("y", 1).style("fill", TOKENS.muted).text(who === "player" ? subjectLabel : "League");
  });

  const ms = animate ? motionMs(400) : 0;
  const bars = root
    .append("g")
    .selectAll("rect")
    .data(groups.flatMap((g) => g.bars))
    .join("rect")
    .attr("x", (b) => b.x)
    .attr("width", (b) => b.width)
    .attr("y", (b) => (ms ? H - M.bottom : b.y))
    .attr("height", (b) => (ms ? 0 : b.height))
    .style("fill", (b) => (b.who === "player" ? TOKENS.accent : TOKENS.muted))
    .style("fill-opacity", (b) => (b.who === "player" ? 1 : 0.55));
  if (ms) bars.transition().duration(ms).attr("y", (b) => b.y).attr("height", (b) => b.height);

  const tip = tooltip(root, W, H);
  root
    .append("g")
    .selectAll("rect")
    .data(groups)
    .join("rect")
    .attr("x", (g) => g.x)
    .attr("width", (g) => g.width)
    .attr("y", M.top)
    .attr("height", H - M.top - M.bottom)
    .style("fill", "transparent")
    .on("pointerenter", (_, g) => {
      const line = (who: string, b: DistanceBin) =>
        metric === "share" ? `${who}: ${fmtPct(b.share)} of shots (${b.attempts})` : `${who}: ${fmtPct(b.fgPct)} (${b.makes}/${b.attempts})`;
      tip.show(g.x + g.width / 2, M.top + 40, [`${g.label} ft`, line(subjectLabel, g.player), line("League", g.league)]);
    })
    .on("pointerleave", () => tip.hide());

  setViewBox(svg, W, H);
  return () => {
    bars.interrupt();
    root.remove();
  };
}

/** A text version for assistive tech: the player's and the league's value in every bin. */
export function describeBars(data: DistanceBarsData, metric: BarMetric, subjectLabel = "Player"): string {
  const what = metric === "share" ? "share of shots" : "FG%";
  const { groups } = barLayout(data, metric);
  return `${what} by distance, ${subjectLabel.toLowerCase()} vs league: ${groups
    .map((g) => `${g.label} ft ${fmtPct(g.bars[0].value)} vs ${fmtPct(g.bars[1].value)}`)
    .join("; ")}.`;
}
