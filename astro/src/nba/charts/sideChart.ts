import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import type { SideBin, Split } from "../data/aggregate";
import { DEFAULT_WIDTH } from "./court";
import type { BarMetric } from "./distanceBars";
import { fmtPct } from "../format";
import { drawNotes, FONT_PX, motionMs, setViewBox, tooltip, TOKENS } from "./theme";

/** `statsBySide` for the player and for the league, same `binFt`. */
export interface SideChartData {
  player: SideBin[];
  league: SideBin[];
  binFt: number;
}

export type Side = "left" | "centre" | "right";
const SIDES: Side[] = ["left", "centre", "right"];

const M = { top: 38, right: 10, bottom: 10, left: 60 };
const ROW = 20;
const CENTRE_W = 56; // px given to the centre column
/** FG% bars (any side) need this many attempts; fewer draws no bar. */
export const SIDE_MIN_ATTEMPTS = 5;
const NOTE = `centre (x = 0, straight on) has its own, narrower scale; FG% bars need ${SIDE_MIN_ATTEMPTS}+ attempts`;

export function sideViewBox(rows: number, width: number = DEFAULT_WIDTH) {
  return { width, height: M.top + rows * ROW + M.bottom + 36 };
}

export interface SideBar {
  side: Side;
  /** Player bar, left edge and width in px. */
  x: number;
  width: number;
  /** League marker position in px (null when the league has no attempts there). */
  leagueX: number | null;
  value: number | null;
  league: number | null;
}

export interface SideRow {
  label: string;
  y: number;
  bars: SideBar[];
  player: SideBin;
  league: SideBin;
}

function totals(bins: SideBin[]): number {
  return bins.reduce((a, b) => a + b.left.attempts + b.centre.attempts + b.right.attempts, 0);
}

/**
 * Mirrored bars: left grows leftwards from the centre column, right grows rightwards, centre is
 * a bar centred in its own column. "share" = the side-bin's share of all the player's attempts
 * (the league's for the marker); "fgPct" = FG% in that side-bin.
 */
export function sideLayout(data: SideChartData, metric: BarMetric, width: number = DEFAULT_WIDTH): { rows: SideRow[]; max: number } {
  if (data.player.length !== data.league.length) throw new Error("sideLayout: player and league bins differ");
  const [pTotal, lTotal] = [totals(data.player), totals(data.league)];
  const val = (s: Split, total: number) =>
    metric === "share" ? (total ? s.attempts / total : null) : s.attempts >= SIDE_MIN_ATTEMPTS ? s.fgPct : null;
  const all = [...data.player, ...data.league].flatMap((b, i) => SIDES.map((s) => val(b[s], i < data.player.length ? pTotal : lTotal)));
  const top = metric === "fgPct" ? 1 : (max(all, (v) => v ?? 0) ?? 0) || 0.1;
  const mid = (M.left + width - M.right) / 2;
  const halfW = mid - CENTRE_W / 2 - M.left;
  const h = scaleLinear().domain([0, top]).range([0, halfW]).clamp(true);
  const c = scaleLinear().domain([0, top]).range([0, CENTRE_W - 6]).clamp(true);
  const place = (side: Side, v: number | null): [number, number] => {
    const len = v === null ? 0 : side === "centre" ? c(v) : h(v);
    if (side === "left") return [mid - CENTRE_W / 2 - len, len];
    if (side === "right") return [mid + CENTRE_W / 2, len];
    return [mid - len / 2, len];
  };
  const markerX = (side: Side, v: number | null) => {
    if (v === null) return null;
    const [x, w] = place(side, v);
    return side === "left" ? x : x + w; // the bar's outer end (centre: its right end)
  };
  const rows = data.player.map((player, i): SideRow => {
    const league = data.league[i];
    const lo = player.distance;
    return {
      label: data.binFt === 1 ? `${lo} ft` : `${lo}-${lo + data.binFt - 1} ft`,
      y: M.top + i * ROW,
      player,
      league,
      bars: SIDES.map((side) => {
        const value = val(player[side], pTotal);
        const leagueValue = val(league[side], lTotal);
        const [x, barWidth] = place(side, value);
        return { side, x, width: barWidth, value, league: leagueValue, leagueX: markerX(side, leagueValue) };
      }),
    };
  });
  return { rows, max: top };
}

export function renderSideChart(
  svg: SVGSVGElement,
  data: SideChartData,
  { metric, width, animate = true }: { metric: BarMetric; width: number; animate?: boolean },
): () => void {
  const { rows } = sideLayout(data, metric, width);
  const W = width;
  const H = M.top + rows.length * ROW + M.bottom;
  const mid = (M.left + W - M.right) / 2;
  const root = select(svg).append("g");

  const head = root.append("g").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted);
  head.append("text").attr("x", mid - CENTRE_W / 2 - 4).attr("y", 14).attr("text-anchor", "end").text("← left");
  head.append("text").attr("x", mid).attr("y", 14).attr("text-anchor", "middle").text("centre");
  head.append("text").attr("x", mid + CENTRE_W / 2 + 4).attr("y", 14).text("right →");
  head.append("text").attr("x", M.left - 6).attr("y", 30).attr("text-anchor", "end").text("distance");
  head.append("text").attr("x", W - M.right).attr("y", 30).attr("text-anchor", "end").text("| = league");
  root
    .append("g")
    .selectAll("line")
    .data([mid - CENTRE_W / 2, mid + CENTRE_W / 2])
    .join("line")
    .attr("x1", (d) => d)
    .attr("x2", (d) => d)
    .attr("y1", M.top - 4)
    .attr("y2", H - M.bottom)
    .style("stroke", TOKENS.line);

  const row = root
    .append("g")
    .selectAll("g")
    .data(rows)
    .join("g")
    .attr("transform", (r) => `translate(0,${r.y})`);
  row
    .append("text")
    .attr("x", M.left - 6)
    .attr("y", ROW / 2 + 4)
    .attr("text-anchor", "end")
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.muted)
    .text((r) => r.label);

  const ms = animate ? motionMs(400) : 0;
  const bars = row
    .selectAll("rect")
    .data((r) => r.bars)
    .join("rect")
    .attr("y", 4)
    .attr("height", ROW - 8)
    .attr("x", (b) => (ms && b.side === "left" ? b.x + b.width : ms && b.side === "centre" ? b.x + b.width / 2 : b.x))
    .attr("width", (b) => (ms ? 0 : b.width))
    .style("fill", TOKENS.accent)
    .style("fill-opacity", (b) => (b.side === "centre" ? 0.7 : 1));
  if (ms) bars.transition().duration(ms).attr("x", (b) => b.x).attr("width", (b) => b.width);

  row
    .selectAll("line")
    .data((r) => r.bars.filter((b) => b.leagueX !== null))
    .join("line")
    .attr("x1", (b) => b.leagueX ?? 0)
    .attr("x2", (b) => b.leagueX ?? 0)
    .attr("y1", 2)
    .attr("y2", ROW - 2)
    .style("stroke", TOKENS.fg)
    .style("stroke-width", 1.5);

  const tip = tooltip(root, W, H);
  row
    .append("rect")
    .attr("x", M.left)
    .attr("width", W - M.left - M.right)
    .attr("height", ROW)
    .style("fill", "transparent")
    .on("pointerenter", (_, r) => {
      tip.show(mid, r.y + ROW, [
        r.label,
        ...r.bars.map(
          (b) => `${b.side}: ${fmtPct(b.value)} (league ${fmtPct(b.league)}), ${r.player[b.side].makes}/${r.player[b.side].attempts}`,
        ),
      ]);
    })
    .on("pointerleave", () => tip.hide());

  const notes = drawNotes(root, M.left, H + 2, W - M.left - M.right, [NOTE]);
  setViewBox(svg, W, H + 6 + notes);
  return () => {
    bars.interrupt();
    root.remove();
  };
}

/** A text version for assistive tech: each distance row's left / centre / right values. */
export function describeSides(data: SideChartData, metric: BarMetric): string {
  const { rows } = sideLayout(data, metric);
  const what = metric === "share" ? "share of shots" : "FG%";
  return `${what} left, centre and right of the hoop (league in brackets): ${rows
    .filter((r) => r.bars.some((b) => b.value !== null && b.value > 0))
    .map((r) => `${r.label} ${r.bars.map((b) => `${b.side} ${fmtPct(b.value)} (${fmtPct(b.league)})`).join(", ")}`)
    .join("; ")}.`;
}
