import { max } from "d3-array";
import { scaleLinear } from "d3-scale";
import { pointer, select } from "d3-selection";
import { area, curveMonotoneX, line } from "d3-shape";
import { shrunkDiff, type DistanceVsLeague } from "../data/aggregate";
import { fmtPct, fmtPts } from "../format";
import { DEFAULT_WIDTH } from "./court";
import { chartTheme, diffColor, drawDiffLegend, FONT_PX, motionMs, setViewBox, SHRINK_NOTE, TOKENS, uniqueId, wrapText } from "./theme";

/** 1-ft bins 0..35 from `vsLeague(fgPctByDistance(player), fgPctByDistance(league))`. */
export type ShootingSignatureData = DistanceVsLeague[];

const PLOT_H = 190;
const M = { top: 36, right: 12, left: 40 };
const MAX_HALF = 20; // px half-width of the ribbon at the busiest distance
const STEP = 0.25; // ft between sampled points
const SIGMA = 0.9; // ft, kernel width for makes and attempts
/** The ribbon stops at the last 1-ft bin with at least this many attempts. */
export const RIBBON_MIN_ATTEMPTS = 5;
/** No ribbon where the kernel-weighted attempts nearby fall below this (a gap, not 0%). */
export const MIN_EFFECTIVE_ATTEMPTS = 5;

/** Server-rendered viewBox before measuring. */
export const SIGNATURE_VIEWBOX = { width: DEFAULT_WIDTH, height: M.top + PLOT_H + 110 };

/** Gaussian kernel smoothing; with `weights` it is a weighted local mean (empty bins do not pull to 0). */
export function kernelSmooth(values: number[], weights: number[] | null, sigma: number): number[] {
  const reach = Math.ceil(sigma * 3);
  return values.map((_, i) => {
    let num = 0;
    let den = 0;
    for (let j = Math.max(0, i - reach); j <= Math.min(values.length - 1, i + reach); j++) {
      const k = Math.exp(-((i - j) ** 2) / (2 * sigma * sigma)) * (weights ? weights[j] : 1);
      num += k * values[j];
      den += k;
    }
    return den > 0 ? num / den : 0;
  });
}

/** Gaussian kernel sums (weight 1 at the bin itself): the effective count of makes or attempts near each bin. */
export function kernelSum(values: number[], sigma: number): number[] {
  const reach = Math.ceil(sigma * 3);
  return values.map((_, i) => {
    let sum = 0;
    for (let j = Math.max(0, i - reach); j <= Math.min(values.length - 1, i + reach); j++) {
      sum += Math.exp(-((i - j) ** 2) / (2 * sigma * sigma)) * values[j];
    }
    return sum;
  });
}

/** The last distance (ft) whose bin has RIBBON_MIN_ATTEMPTS or more; null when none does. */
export function ribbonEnd(bins: ShootingSignatureData): number | null {
  const last = bins.findLast((b) => b.attempts >= RIBBON_MIN_ATTEMPTS);
  return last ? last.distance : null;
}

export interface SignaturePoint {
  distance: number;
  /** Effective makes / attempts near this distance; null (a gap in the ribbon) under MIN_EFFECTIVE_ATTEMPTS. */
  fgPct: number | null;
  leagueFgPct: number | null;
  share: number;
  /** The colour: shrunkDiff(effective makes, effective attempts, league FG%), null in a gap. */
  colourDiff: number | null;
}

/**
 * Every 0.25 ft: FG% from separately kernel-summed makes and attempts (so a stretch with no shots
 * is a gap, never 0%), the league FG%, the smoothed shot share, and the shrunk colour value.
 */
export function signaturePoints(bins: ShootingSignatureData): SignaturePoint[] {
  const attempts = kernelSum(bins.map((b) => b.attempts), SIGMA);
  const makes = kernelSum(bins.map((b) => b.makes), SIGMA);
  const share = kernelSmooth(bins.map((b) => b.share), null, 1);
  const league = kernelSmooth(bins.map((b) => b.leagueFgPct ?? 0), bins.map((b) => (b.leagueFgPct === null ? 0 : 1)), 0.6);
  const hasLeague = bins.map((b) => b.leagueFgPct !== null);
  const end = ribbonEnd(bins);
  const last = bins.length - 1;
  const lerp = (a: number[], d: number) => {
    const i = Math.min(Math.floor(d), last);
    const j = Math.min(i + 1, last);
    return a[i] + (a[j] - a[i]) * (d - i);
  };
  return Array.from({ length: Math.round(last / STEP) + 1 }, (_, k) => {
    const d = k * STEP;
    const a = lerp(attempts, d);
    const m = lerp(makes, d);
    const leagueFgPct = hasLeague[Math.min(Math.round(d), last)] ? lerp(league, d) : null;
    const ok = end !== null && d <= end && a >= MIN_EFFECTIVE_ATTEMPTS;
    return {
      distance: d,
      fgPct: ok ? m / a : null,
      leagueFgPct,
      share: lerp(share, d),
      colourDiff: ok && leagueFgPct !== null ? shrunkDiff(m, a, leagueFgPct) : null,
    };
  });
}

/** A text version for assistive tech: FG% against the league in 5-ft ranges. */
export function describeSignature(bins: ShootingSignatureData): string {
  const parts: string[] = [];
  for (let lo = 0; lo < bins.length; lo += 5) {
    const range = bins.slice(lo, lo + 5).filter((b) => b.attempts > 0);
    const att = range.reduce((s, b) => s + b.attempts, 0);
    if (!att) continue;
    const mk = range.reduce((s, b) => s + b.makes, 0);
    const lg = range.filter((b) => b.leagueFgPct !== null);
    const lgPct = lg.length ? lg.reduce((s, b) => s + (b.leagueFgPct ?? 0) * b.attempts, 0) / lg.reduce((s, b) => s + b.attempts, 0) : null;
    parts.push(`${lo}-${Math.min(lo + 4, bins.length - 1)} ft ${mk}/${att} (${fmtPct(mk / att)}, league ${fmtPct(lgPct)})`);
  }
  return `FG% by distance against the league: ${parts.join("; ")}.`;
}

export function renderShootingSignature(
  svg: SVGSVGElement,
  data: ShootingSignatureData,
  { width, animate = true }: { width: number; animate?: boolean },
): () => void {
  const W = width;
  const theme = chartTheme(svg);
  const root = select(svg).append("g");
  const points = signaturePoints(data);
  const drawn = points.filter((p) => p.fgPct !== null);
  const maxFt = data.length - 1;
  const bottom = M.top + PLOT_H;
  const x = scaleLinear().domain([0, maxFt]).range([M.left, W - M.right]);
  const y = scaleLinear().domain([0, 1]).range([bottom, M.top]).clamp(true);
  const maxShare = max(drawn, (p) => p.share) || 1;
  const half = (p: SignaturePoint) => Math.max((p.share / maxShare) * MAX_HALF, 0.75);

  // Grid and axes, drawn by hand (no d3-axis in the dependency set).
  const axes = root.append("g").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
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
    .text((d) => `${d * 100}%`);
  axes
    .selectAll("text.x")
    .data(x.ticks(W < 420 ? 4 : 7))
    .join("text")
    .attr("class", "x")
    .attr("x", (d) => x(d))
    .attr("y", bottom + FONT_PX + 5)
    .attr("text-anchor", "middle")
    .text((d) => `${d} ft`);

  // League FG%: faint over the whole range, full strength where the player's ribbon runs.
  const leagueLine = (strong: boolean) =>
    line<SignaturePoint>()
      .defined((p) => p.leagueFgPct !== null && (!strong || p.fgPct !== null))
      .x((p) => x(p.distance))
      .y((p) => y(p.leagueFgPct ?? 0))
      .curve(curveMonotoneX);
  for (const strong of [false, true]) {
    root
      .append("path")
      .datum(points)
      .attr("d", leagueLine(strong))
      .style("fill", "none")
      .style("stroke", TOKENS.muted)
      .style("stroke-opacity", strong ? 1 : 0.4)
      .style("stroke-dasharray", "3 3");
  }

  const gradient = uniqueId("bn-signature");
  root
    .append("defs")
    .append("linearGradient")
    .attr("id", gradient)
    .attr("gradientUnits", "userSpaceOnUse")
    .attr("x1", x(0))
    .attr("x2", x(maxFt))
    .selectAll("stop")
    .data(drawn.filter((_, i) => i % 2 === 0))
    .join("stop")
    .attr("offset", (p) => `${(p.distance / maxFt) * 100}%`)
    .attr("stop-color", (p) => diffColor(p.colourDiff, theme));
  const ribbon = root
    .append("path")
    .datum(points)
    .attr(
      "d",
      area<SignaturePoint>()
        .defined((p) => p.fgPct !== null)
        .x((p) => x(p.distance))
        .y0((p) => y(p.fgPct ?? 0) + half(p))
        .y1((p) => y(p.fgPct ?? 0) - half(p))
        .curve(curveMonotoneX),
    )
    .style("fill", `url(#${gradient})`)
    .style("stroke", TOKENS.fg)
    .style("stroke-opacity", 0.2)
    .style("stroke-width", 0.5);
  const ms = animate ? motionMs(600) : 0;
  if (ms) ribbon.style("opacity", 0).transition().duration(ms).style("opacity", 1);

  // Cursor: vertical rule, a dot on the curve, and the raw numbers of the 1-ft bin under it.
  const cursor = root.append("g").style("display", "none").attr("pointer-events", "none");
  cursor.append("line").attr("y1", M.top).attr("y2", bottom).style("stroke", TOKENS.fg).style("stroke-opacity", 0.5);
  const dot = cursor.append("circle").attr("r", 3);
  const readout = root.append("text").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.fg);
  root
    .append("rect")
    .attr("x", M.left)
    .attr("y", M.top)
    .attr("width", W - M.left - M.right)
    .attr("height", PLOT_H)
    .style("fill", "transparent")
    .on("pointermove", (event: PointerEvent) => {
      const [px] = pointer(event, root.node());
      const p = points[Math.max(0, Math.min(points.length - 1, Math.round(x.invert(px) / STEP)))];
      const b = data[Math.min(Math.round(p.distance), maxFt)];
      cursor.style("display", null).attr("transform", `translate(${x(p.distance)},0)`);
      dot.attr("cy", y(p.fgPct ?? p.leagueFgPct ?? 0)).style("fill", p.fgPct !== null ? TOKENS.fg : TOKENS.muted);
      const text =
        `${b.distance} ft: ${b.makes}/${b.attempts}` +
        (b.fgPct === null ? "" : ` (${fmtPct(b.fgPct)})`) +
        ` vs league ${fmtPct(b.leagueFgPct)}` +
        (b.diff === null ? "" : `, ${fmtPts(b.diff)}`);
      readout
        .selectAll("tspan")
        .data(wrapText(text, W - M.left - M.right).slice(0, 2))
        .join("tspan")
        .attr("x", M.left)
        .attr("y", (_, i) => 12 + i * 14)
        .text((d) => d);
    })
    .on("pointerleave", () => {
      cursor.style("display", "none");
      readout.selectAll("tspan").remove();
    });

  const legend = root.append("g").attr("transform", `translate(${M.left},${bottom + FONT_PX + 18})`);
  const used = drawDiffLegend(legend, 0, 0, W - M.left - M.right, theme, [
    "dashed line: league FG%; ribbon width: share of shots",
    `no ribbon where fewer than ${MIN_EFFECTIVE_ATTEMPTS} attempts nearby; ${SHRINK_NOTE}`,
  ]);
  setViewBox(svg, W, bottom + FONT_PX + 18 + used + 6);

  return () => {
    ribbon.interrupt();
    root.remove();
  };
}
