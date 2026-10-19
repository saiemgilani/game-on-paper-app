import { quantile } from "d3-array";
import { Delaunay } from "d3-delaunay";
import { hexbin } from "d3-hexbin";
import { scaleSqrt, type ScalePower } from "d3-scale";
import { pointer, select, type Selection } from "d3-selection";
import type { Court } from "../../basketball/config";
import { shrunkDiff, type HexVsLeague, type Split, type Zone } from "../data/aggregate";
import { COURT, toSvg, toSvgLength, zoneAreas, type Viewport } from "../data/court";
import { courtViewport, DEFAULT_WIDTH, drawCourt } from "./court";
import { fmtPct, fmtPts } from "../format";
import { chartTheme, diffColor, drawDiffLegend, drawNotes, FONT_PX, motionMs, setViewBox, SHRINK_NOTE, tooltip, TOKENS, type ChartTheme, type G } from "./theme";

export interface ZoneComparison {
  player: Split;
  league: Split;
}

export interface HexShotChartData {
  /** Player hexes from `hexesVsLeague`, legacy frame. */
  hexes: HexVsLeague[];
  /** Hex radius in tenths of a foot (the radius the hexes were binned with). */
  radius: number;
  /** `statsByZone` for the player and the league. */
  zones: Record<Zone, ZoneComparison>;
  /** The court the zones were cut on and the chart draws; absent = the NBA's COURT. */
  court?: Court;
}

export type HexMode = "raw" | "zones";

export interface HexShotChartOptions {
  width: number;
  mode: HexMode;
  /** Grow the hexes in (first draw only; redraws on resize or theme change are instant). */
  animate?: boolean;
}

export const ZONE_LABELS: Record<Zone, string> = {
  restricted_area: "Restricted area",
  paint: "Paint (non-RA)",
  mid_range: "Mid-range",
  corner_3_left: "Left corner 3",
  corner_3_right: "Right corner 3",
  above_break_3: "Above-the-break 3",
};


/** Server-rendered viewBox before measuring (court + a typical legend). */
export const HEX_VIEWBOX = { width: DEFAULT_WIDTH, height: courtViewport().height + 110 };

/** The colour a hex or zone gets: its FG% vs league, shrunk toward the league (null without a league rate). */
export function colourDiff(makes: number, attempts: number, league: number | null): number | null {
  return league === null || attempts === 0 ? null : shrunkDiff(makes, attempts, league);
}

export interface HexMark {
  hex: HexVsLeague;
  cx: number;
  cy: number;
  r: number;
  fill: string;
}

/**
 * Pixel marks for the hexes inside the viewport: size is a sqrt scale of attempts capped at the
 * 95th percentile (so one busy rim hex does not shrink the rest), colour is the shrunk FG% vs league.
 */
export function layoutHexes(
  hexes: HexVsLeague[],
  radius: number,
  v: Viewport,
  theme: ChartTheme = "light",
): { marks: HexMark[]; cap: number; size: ScalePower<number, number> } {
  const cap = Math.max(2, Math.ceil(quantile(hexes, 0.95, (h) => h.attempts) ?? 2));
  const size = scaleSqrt().domain([0, cap]).range([0, toSvgLength(radius, v)]).clamp(true);
  const marks = hexes
    .filter((h) => h.y <= v.top)
    .map((hex) => {
      const p = toSvg(hex, v);
      return { hex, cx: p.x, cy: p.y, r: size(hex.attempts), fill: diffColor(colourDiff(hex.makes, hex.attempts, hex.leagueFgPct), theme) };
    })
    .sort((a, b) => a.hex.attempts - b.hex.attempts);
  return { marks, cap, size };
}

/** A zone label with a background-coloured halo so it reads over any fill. */
const label = (g: G, text: string, y = 0): Selection<SVGTextElement, unknown, null, undefined> =>
  g
    .append("text")
    .attr("text-anchor", "middle")
    .attr("y", y)
    .text(text)
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.fg)
    .style("stroke", TOKENS.bg)
    .style("stroke-width", 3)
    .style("stroke-linejoin", "round")
    .style("paint-order", "stroke");

function drawZones(root: G, data: HexShotChartData, v: Viewport, theme: ChartTheme, tip: ReturnType<typeof tooltip>, court: Court): void {
  const areas = zoneAreas(v, court);
  root
    .append("g")
    .selectAll("path")
    .data(areas)
    .join("path")
    .attr("d", (a) => a.d)
    .attr("fill-rule", "evenodd")
    .style("fill", (a) => {
      const z = data.zones[a.zone];
      return diffColor(colourDiff(z.player.makes, z.player.attempts, z.league.fgPct), theme);
    })
    .style("fill-opacity", 0.85)
    .on("pointermove", (event: PointerEvent, a) => {
      const z = data.zones[a.zone];
      const [px, py] = pointer(event, root.node());
      tip.show(px, py, [
        ZONE_LABELS[a.zone],
        `${z.player.makes}/${z.player.attempts} FG, ${fmtPct(z.player.fgPct)}`,
        `League ${fmtPct(z.league.fgPct)}` +
          (z.player.fgPct !== null && z.league.fgPct !== null ? ` (${fmtPts(z.player.fgPct - z.league.fgPct)})` : ""),
      ]);
    })
    .on("pointerleave", () => tip.hide());
  drawCourt(root, v, { zones: true, court });
  const labels = root.append("g").attr("pointer-events", "none");
  for (const a of areas) {
    const { player: z, league } = data.zones[a.zone];
    const g = labels.append("g").attr("transform", `translate(${a.label.x},${a.label.y})${a.vertical ? " rotate(-90)" : ""}`);
    if (a.vertical) {
      label(g, `${fmtPct(z.fgPct, 0)} · ${z.makes}/${z.attempts}`, -2);
      label(g, `lg ${fmtPct(league.fgPct, 0)}`, FONT_PX);
    } else {
      label(g, fmtPct(z.fgPct, 0)).style("font-weight", "600");
      label(g, `${z.makes}/${z.attempts}`, FONT_PX + 2);
      label(g, `lg ${fmtPct(league.fgPct, 0)}`, 2 * (FONT_PX + 2));
    }
  }
}

export function renderHexShotChart(svg: SVGSVGElement, data: HexShotChartData, { width, mode, animate = true }: HexShotChartOptions): () => void {
  const v = courtViewport(width);
  const court = data.court ?? COURT;
  const theme = chartTheme(svg);
  const root = select(svg).append("g");
  const shape = hexbin();
  let hexes: ReturnType<typeof root.selectAll<SVGPathElement, HexMark>> | null = null;

  if (mode === "zones") {
    drawZones(root, data, v, theme, tooltip(root, v.width, v.height), court);
  } else {
    drawCourt(root, v, { court });
    const { marks, cap, size } = layoutHexes(data.hexes, data.radius, v, theme);
    const ms = animate ? motionMs(500) : 0;
    hexes = root
      .append("g")
      .selectAll<SVGPathElement, HexMark>("path")
      .data(marks)
      .join("path")
      .attr("transform", (m) => `translate(${m.cx},${m.cy})`)
      .attr("d", (m) => shape.hexagon(ms ? 0 : m.r))
      .style("fill", (m) => m.fill)
      // A full-strength outline keeps average (near-background) hexes visible: size carries meaning.
      .style("stroke", TOKENS.muted)
      .style("stroke-width", 0.85);
    if (ms) hexes.transition().duration(ms).attr("d", (m) => shape.hexagon(m.r));

    // Hover: nearest hex centre (Delaunay), within 18 px.
    const focus = root.append("path").style("fill", "none").style("stroke", TOKENS.fg).style("stroke-width", 1.5).style("display", "none");
    const tip = tooltip(root, v.width, v.height);
    const delaunay = Delaunay.from(marks, (m) => m.cx, (m) => m.cy);
    root
      .append("rect")
      .attr("width", v.width)
      .attr("height", v.height)
      .style("fill", "transparent")
      .on("pointermove", (event: PointerEvent) => {
        const [px, py] = pointer(event, root.node());
        const m = marks.length ? marks[delaunay.find(px, py)] : undefined;
        if (!m || Math.hypot(m.cx - px, m.cy - py) > 18) {
          focus.style("display", "none");
          tip.hide();
          return;
        }
        const h = m.hex;
        focus.style("display", null).attr("transform", `translate(${m.cx},${m.cy})`).attr("d", shape.hexagon(Math.max(m.r, 4)));
        tip.show(m.cx, m.cy, [
          ZONE_LABELS[h.zone],
          `${h.makes}/${h.attempts} FG, ${fmtPct(h.fgPct)}`,
          `League ${fmtPct(h.leagueFgPct)}` +
            (h.fgPct !== null && h.leagueFgPct !== null ? ` (${fmtPts(h.fgPct - h.leagueFgPct)})` : ""),
          `${h.meanDistance.toFixed(1)} ft`,
        ]);
      })
      .on("pointerleave", () => {
        focus.style("display", "none");
        tip.hide();
      });

    // Legend rows: colour key first, then the size key.
    const legend = root.append("g").attr("transform", `translate(12,${v.height + 12})`);
    const used = drawDiffLegend(legend, 0, 0, width - 24, theme, [SHRINK_NOTE]);
    const steps = [1, Math.max(2, Math.round(cap / 2)), cap];
    const key = legend.append("g").attr("transform", `translate(0,${used + 8})`);
    steps.forEach((n, i) => {
      const x = 12 + i * 34;
      key.append("path").attr("transform", `translate(${x},10)`).attr("d", shape.hexagon(size(n))).style("fill", TOKENS.muted);
      key
        .append("text")
        .attr("x", x)
        .attr("y", 36)
        .attr("text-anchor", "middle")
        .style("font-size", `${FONT_PX}px`)
        .style("fill", TOKENS.muted)
        .text(i === steps.length - 1 ? `${n}+` : String(n));
    });
    drawNotes(key, 118, 4, width - 24 - 118, ["hex size: attempts"]);
    setViewBox(svg, width, v.height + 12 + used + 8 + 42);
  }

  if (mode === "zones") {
    const legend = root.append("g").attr("transform", `translate(12,${v.height + 12})`);
    const used = drawDiffLegend(legend, 0, 0, width - 24, theme, [SHRINK_NOTE]);
    setViewBox(svg, width, v.height + 12 + used + 6);
  }

  return () => {
    hexes?.interrupt();
    root.remove();
  };
}

/** A text version for assistive tech: every zone's makes/attempts, FG% and the league FG%. */
export function describeHex(data: HexShotChartData): string {
  const zones = (Object.keys(ZONE_LABELS) as Zone[]).map((z) => {
    const { player, league } = data.zones[z];
    return `${ZONE_LABELS[z]} ${player.makes}/${player.attempts} (${fmtPct(player.fgPct)}, league ${fmtPct(league.fgPct)})`;
  });
  const attempts = data.hexes.reduce((a, h) => a + h.attempts, 0);
  return `${attempts} attempts in ${data.hexes.length} hexes. By zone: ${zones.join("; ")}.`;
}
