import { select } from "d3-selection";
import { courtLines, viewport, zoneLines, type Viewport } from "../data/court";
import { setViewBox, TOKENS, type G } from "./theme";

/** Charts show the half court from the baseline up to 35 ft, hoop at the bottom (the 2021 orientation). */
export const COURT_TOP = 350;
/**
 * Margin (tenths of a foot) past the sidelines and baseline: hexes centred on the edge of the
 * court (|x| up to 259.8 for 1.5 ft hexes) stay whole.
 */
export const COURT_PAD = 25;
/** Layout width before the chart is measured (the server-rendered viewBox). */
export const DEFAULT_WIDTH = 500;

export function courtViewport(width: number = DEFAULT_WIDTH): Viewport {
  return viewport(width, COURT_TOP, COURT_PAD);
}

export interface CourtOptions {
  width: number;
  /** Outline the zones `zoneOf` uses (dashed, in the text colour). */
  zones?: boolean;
}

export function drawCourt(g: G, v: Viewport, { zones = false }: { zones?: boolean } = {}): void {
  g.append("g")
    .attr("class", "court")
    .selectAll("path")
    .data(courtLines(v))
    .join("path")
    .attr("d", (l) => l.d)
    .style("fill", "none")
    .style("stroke", TOKENS.muted)
    .style("stroke-opacity", 0.6)
    .style("stroke-width", 1)
    .style("stroke-dasharray", (l) => (l.dashed ? "4 4" : null));
  if (!zones) return;
  g.append("g")
    .attr("class", "zones")
    .selectAll("path")
    .data(zoneLines(v))
    .join("path")
    .attr("d", (l) => l.d)
    .style("fill", "none")
    .style("stroke", TOKENS.fg)
    .style("stroke-opacity", 0.7)
    .style("stroke-width", 1.25)
    .style("stroke-dasharray", "6 3");
}

export const COURT_VIEWBOX = { width: DEFAULT_WIDTH, height: courtViewport().height };

export function renderCourt(svg: SVGSVGElement, { width, zones }: CourtOptions): () => void {
  const v = courtViewport(width);
  const root = select(svg).append("g");
  drawCourt(root, v, { zones });
  setViewBox(svg, v.width, v.height);
  return () => root.remove();
}
