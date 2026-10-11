import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import type { OpponentLine } from "../data/aggregate";
import { fmtPct } from "../format";
import { DEFAULT_WIDTH } from "./court";
import { drawNotes, FONT_PX, motionMs, setViewBox, tooltip, TOKENS } from "./theme";

/** Mirrored bars per opponent: attempts to the left, FG% to the right, league FG% as a rule. */

export interface VersusData {
  rows: OpponentLine[];
  leagueFgPct: number | null;
}

/** FG% bars need this many attempts against the opponent. */
export const VERSUS_MIN_ATTEMPTS = 5;
const M = { top: 30, right: 10, left: 10 };
const ROW = 18;
const LABEL_W = 44;
/** Room at each outer end for the bar's number. */
const NUM_W = 34;

export function versusViewBox(rows: number, width: number = DEFAULT_WIDTH) {
  return { width, height: M.top + rows * ROW + 50 };
}

export function describeVersus(data: VersusData): string {
  return `Against each opponent, most attempts first: ${data.rows
    .map((r) => `${r.opponent} ${r.makes}/${r.attempts} (${fmtPct(r.fgPct)}) in ${r.games} games`)
    .join("; ")}. League FG% ${fmtPct(data.leagueFgPct)}.`;
}

export function renderVersus(svg: SVGSVGElement, data: VersusData, { width: W, animate = true }: { width: number; animate?: boolean }): () => void {
  const root = select(svg).append("g");
  const rows = data.rows;
  const mid = W / 2;
  const half = mid - LABEL_W / 2 - M.left;
  const att = scaleLinear()
    .domain([0, max(rows, (r) => r.attempts) ?? 1])
    .range([0, half - NUM_W]);
  const pct = scaleLinear().domain([0, 1]).range([0, W - M.right - NUM_W - (mid + LABEL_W / 2)]).clamp(true);
  const bottom = M.top + rows.length * ROW;

  const head = root.append("g").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted);
  head.append("text").attr("x", mid - LABEL_W / 2 - 4).attr("y", 14).attr("text-anchor", "end").text("attempts ←");
  head.append("text").attr("x", mid + LABEL_W / 2 + 4).attr("y", 14).text("→ FG%");
  if (data.leagueFgPct !== null) {
    const lx = mid + LABEL_W / 2 + pct(data.leagueFgPct);
    root.append("line").attr("x1", lx).attr("x2", lx).attr("y1", M.top - 6).attr("y2", bottom).style("stroke", TOKENS.fg).style("stroke-dasharray", "3 3");
    head.append("text").attr("x", lx).attr("y", 26).attr("text-anchor", "middle").text(`league ${fmtPct(data.leagueFgPct, 0)}`);
  }

  const row = root
    .append("g")
    .selectAll("g")
    .data(rows)
    .join("g")
    .attr("transform", (_, i) => `translate(0,${M.top + i * ROW})`);
  row
    .append("text")
    .attr("x", mid)
    .attr("y", ROW / 2 + 4)
    .attr("text-anchor", "middle")
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.fg)
    .text((r) => r.opponent);
  const ms = animate ? motionMs(400) : 0;
  const left = row
    .append("rect")
    .attr("y", 3)
    .attr("height", ROW - 6)
    .attr("x", (r) => mid - LABEL_W / 2 - (ms ? 0 : att(r.attempts)))
    .attr("width", (r) => (ms ? 0 : att(r.attempts)))
    .style("fill", TOKENS.muted);
  const right = row
    .filter((r) => r.attempts >= VERSUS_MIN_ATTEMPTS && r.fgPct !== null)
    .append("rect")
    .attr("y", 3)
    .attr("height", ROW - 6)
    .attr("x", mid + LABEL_W / 2)
    .attr("width", (r) => (ms ? 0 : pct(r.fgPct ?? 0)))
    .style("fill", TOKENS.accent);
  if (ms) {
    left.transition().duration(ms).attr("x", (r) => mid - LABEL_W / 2 - att(r.attempts)).attr("width", (r) => att(r.attempts));
    right.transition().duration(ms).attr("width", (r) => pct(r.fgPct ?? 0));
  }
  // The numbers at the bar ends: attempts on the left, FG% (with makes/attempts in the tooltip) on the right.
  const nums = row.append("g").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.fg).attr("class", "tabular-nums");
  nums
    .append("text")
    .attr("x", (r) => mid - LABEL_W / 2 - att(r.attempts) - 3)
    .attr("y", ROW / 2 + 4)
    .attr("text-anchor", "end")
    .text((r) => r.attempts);
  nums
    .filter((r) => r.attempts >= VERSUS_MIN_ATTEMPTS && r.fgPct !== null)
    .append("text")
    .attr("x", (r) => mid + LABEL_W / 2 + pct(r.fgPct ?? 0) + 3)
    .attr("y", ROW / 2 + 4)
    .text((r) => fmtPct(r.fgPct, 0));

  const tip = tooltip(root, W, bottom + 40);
  row
    .append("rect")
    .attr("x", M.left)
    .attr("width", W - M.left - M.right)
    .attr("height", ROW)
    .style("fill", "transparent")
    .on("pointerenter", (_, r) => {
      const i = rows.indexOf(r);
      tip.show(mid, M.top + i * ROW + ROW, [
        `vs ${r.opponent}, ${r.games} game${r.games === 1 ? "" : "s"}`,
        `${r.makes}/${r.attempts} FG, ${fmtPct(r.fgPct)}`,
        `${fmtPct(r.efgPct)} eFG%, ${fmtPct(r.fg3Pct)} 3P%`,
      ]);
    })
    .on("pointerleave", () => tip.hide());

  const notes = drawNotes(root, M.left, bottom + 6, W - M.left - M.right, [`FG% bars need ${VERSUS_MIN_ATTEMPTS}+ attempts against that team`]);
  setViewBox(svg, W, bottom + 6 + notes + 4);
  return () => {
    left.interrupt();
    right.interrupt();
    root.remove();
  };
}
