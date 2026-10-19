import { extent } from "d3-array";
import { Delaunay } from "d3-delaunay";
import { scaleLinear } from "d3-scale";
import { pointer, select } from "d3-selection";
import { zoom, type ZoomTransform } from "d3-zoom";
import { fmtDec, fmtPct, foldText } from "../format";
import { dotLabels, median, pointValue, SCATTER_INFO, smallHeadshot, type ScatterMetric, type ScatterPoint } from "../scatterMetrics";
import { DEFAULT_WIDTH } from "./court";
import { FONT_PX, setViewBox, tooltip, TOKENS, uniqueId } from "./theme";

/** League scatter (Scattershot-style): two metrics, median crosshair, zoom, dots or headshot faces. */

export interface ScatterOptions {
  width: number;
  x: ScatterMetric;
  y: ScatterMetric;
  /** Draw ESPN headshots (in the canvas) instead of dots. */
  faces: boolean;
  /** Name filter; non-matching players are dimmed. */
  filter: string;
  transform: ZoomTransform;
  onZoom: (t: ZoomTransform) => void;
  /** The canvas laid under the svg for faces (same CSS size). */
  canvas: HTMLCanvasElement | null;
}

const H = 460;
const M = { top: 16, right: 16, bottom: 46, left: 54 };
const FACE_R = 13;

export const SCATTER_VIEWBOX = { width: DEFAULT_WIDTH, height: H };

export const fmtMetric = (m: ScatterMetric, v: number | null) => (SCATTER_INFO[m].pct ? fmtPct(v) : fmtDec(v));

/** Points with both values, and each axis's median over them. */
export function scatterLayout(points: ScatterPoint[], x: ScatterMetric, y: ScatterMetric) {
  const visible = points
    .map((p) => ({ p, x: pointValue(p, x), y: pointValue(p, y) }))
    .filter((d): d is { p: ScatterPoint; x: number; y: number } => d.x !== null && d.y !== null)
    .sort((a, b) => Number(a.p.nets) - Number(b.p.nets)); // the highlighted team draws last, on top
  return { visible, medianX: median(visible.map((d) => d.x)), medianY: median(visible.map((d) => d.y)) };
}

/** A padded, rounded domain so no point sits on the frame. */
export function paddedDomain(values: number[]): [number, number] {
  const [lo, hi] = extent(values);
  if (lo === undefined || hi === undefined) return [0, 1];
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.05;
  return [lo - pad, hi + pad];
}

// Headshots load once per page; a load redraws whichever renders are mounted now (a render that
// was cleaned up while its images were in flight must not swallow their redraw).
const images = new Map<string, HTMLImageElement>();
const redraws = new Set<() => void>();
function face(url: string): HTMLImageElement {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => redraws.forEach((redraw) => redraw());
    img.src = url;
    images.set(url, img);
  }
  return img;
}

export function describeScatter(points: ScatterPoint[], x: ScatterMetric, y: ScatterMetric, highlight: string | null = "Nets", minFga = 100): string {
  const { visible, medianX, medianY } = scatterLayout(points, x, y);
  const named = visible.filter((d) => d.p.nets).map((d) => `${d.p.name} ${fmtMetric(x, d.x)}, ${fmtMetric(y, d.y)}`);
  return `${visible.length} players with ${minFga}+ FGA, ${SCATTER_INFO[y].label} against ${SCATTER_INFO[x].label}; medians ${fmtMetric(x, medianX)} and ${fmtMetric(y, medianY)}.${highlight ? ` ${highlight}: ${named.join("; ")}.` : ""}`;
}

/**
 * d3-zoom's default filter, except that a touch gesture needs two fingers: a one-finger swipe on
 * the plot scrolls the page instead of panning a chart that may not even be zoomed in. Mouse wheel
 * and drag are unchanged.
 */
export function zoomFilter(event: Event): boolean {
  if (event.type === "touchstart") return (event as TouchEvent).touches.length > 1;
  const e = event as MouseEvent;
  return (!e.ctrlKey || e.type === "wheel") && !e.button;
}

export function renderScatter(svg: SVGSVGElement, points: ScatterPoint[], opts: ScatterOptions): () => void {
  const { width: W, x: xm, y: ym, faces, canvas } = opts;
  const q = foldText(opts.filter.trim());
  const match = (p: ScatterPoint) => !q || foldText(p.name).includes(q);
  const root = select(svg).append("g");
  setViewBox(svg, W, H);
  const { visible, medianX, medianY } = scatterLayout(points, xm, ym);
  const x0 = scaleLinear().domain(paddedDomain(visible.map((d) => d.x))).range([M.left, W - M.right]);
  const y0 = scaleLinear().domain(paddedDomain(visible.map((d) => d.y))).range([H - M.bottom, M.top]);
  const clip = uniqueId("bn-scatter-clip");
  root.append("defs").append("clipPath").attr("id", clip).append("rect").attr("x", M.left).attr("y", M.top).attr("width", W - M.left - M.right).attr("height", H - M.top - M.bottom);

  const grid = root.append("g").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted);
  const plot = root.append("g").attr("clip-path", `url(#${clip})`);
  const medians = plot.append("g");
  const dots = plot
    .append("g")
    .selectAll("circle")
    .data(visible)
    .join("circle")
    .attr("r", (d) => (d.p.nets ? 6 : 4.5))
    .style("fill", (d) => (d.p.nets ? TOKENS.accent : d.p.color))
    .style("fill-opacity", (d) => (d.p.nets ? 1 : 0.45))
    .style("stroke", (d) => (d.p.nets ? TOKENS.fg : d.p.color))
    .style("stroke-width", (d) => (d.p.nets ? 1 : 0.75))
    .style("opacity", (d) => (match(d.p) ? 1 : 0.1))
    .style("display", faces ? "none" : "inline");
  const labelOf = dotLabels(visible.map((d) => d.p.name));
  const labels = plot
    .append("g")
    .selectAll("text")
    .data(visible.filter((d) => d.p.nets || (q && match(d.p))))
    .join("text")
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.fg)
    .style("stroke", TOKENS.bg)
    .style("stroke-width", 3)
    .style("paint-order", "stroke")
    .text((d) => labelOf.get(d.p.name) ?? d.p.name);
  root
    .append("text")
    .attr("x", (M.left + W - M.right) / 2)
    .attr("y", H - 6)
    .attr("text-anchor", "middle")
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.fg)
    .text(SCATTER_INFO[xm].label);
  root
    .append("text")
    .attr("transform", `translate(12,${(M.top + H - M.bottom) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.fg)
    .text(SCATTER_INFO[ym].label);

  // Faces: ESPN headshots in a circular clip, drawn in the canvas laid under the svg.
  const ctx = faces && canvas ? canvas.getContext("2d") : null;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  if (canvas) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }
  let pending = 0;
  let current = opts.transform;
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(() => ((pending = 0), drawFaces()));
  };
  if (ctx) redraws.add(schedule);
  const drawFaces = () => {
    if (!ctx || !canvas) return;
    const x = current.rescaleX(x0);
    const y = current.rescaleY(y0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(M.left, M.top, W - M.left - M.right, H - M.top - M.bottom);
    ctx.clip();
    const accent = getComputedStyle(svg).getPropertyValue("--accent").trim() || "#ff6a13";
    for (const d of visible) {
      const cx = x(d.x);
      const cy = y(d.y);
      const alpha = match(d.p) ? 1 : 0.12;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, FACE_R, 0, 2 * Math.PI);
      ctx.globalAlpha = alpha * 0.35; // placeholder until (or unless) the headshot loads
      ctx.fillStyle = d.p.color;
      ctx.fill();
      ctx.globalAlpha = alpha;
      const img = d.p.headshot ? face(smallHeadshot(d.p.headshot)) : null;
      if (img?.complete && img.naturalWidth) {
        ctx.clip();
        const h = FACE_R * 2.3;
        const w = (h * img.naturalWidth) / img.naturalHeight;
        ctx.drawImage(img, cx - w / 2, cy - FACE_R * 1.05, w, h);
      }
      ctx.restore();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, FACE_R, 0, 2 * Math.PI);
      ctx.lineWidth = d.p.nets ? 2.5 : 1.5;
      ctx.strokeStyle = d.p.nets ? accent : d.p.color;
      ctx.stroke();
    }
    ctx.restore();
  };

  // Hover: the nearest visible player within 20 px.
  const tip = tooltip(root, W, H);
  let delaunay = Delaunay.from(visible, () => 0, () => 0);
  let px: number[] = [];
  let py: number[] = [];

  const draw = (t: ZoomTransform) => {
    current = t;
    const x = t.rescaleX(x0);
    const y = t.rescaleY(y0);
    const xt = x.ticks(W < 420 ? 4 : 7);
    const yt = y.ticks(6);
    const fx = (v: number) => (SCATTER_INFO[xm].pct ? `${Math.round(v * 100)}%` : `${v}`);
    const fy = (v: number) => (SCATTER_INFO[ym].pct ? `${Math.round(v * 100)}%` : `${v}`);
    grid.selectAll("*").remove();
    grid.selectAll("line.v").data(xt).join("line").attr("class", "v").attr("x1", x).attr("x2", x).attr("y1", M.top).attr("y2", H - M.bottom).style("stroke", TOKENS.line);
    grid.selectAll("line.h").data(yt).join("line").attr("class", "h").attr("x1", M.left).attr("x2", W - M.right).attr("y1", y).attr("y2", y).style("stroke", TOKENS.line);
    grid.selectAll("text.x").data(xt).join("text").attr("class", "x").attr("x", x).attr("y", H - M.bottom + FONT_PX + 5).attr("text-anchor", "middle").text(fx);
    grid.selectAll("text.y").data(yt).join("text").attr("class", "y").attr("x", M.left - 6).attr("y", (v) => y(v) + 4).attr("text-anchor", "end").text(fy);
    medians.selectAll("*").remove();
    if (medianX !== null) {
      medians.append("line").attr("x1", x(medianX)).attr("x2", x(medianX)).attr("y1", M.top).attr("y2", H - M.bottom).style("stroke", TOKENS.muted).style("stroke-dasharray", "4 4");
      medians.append("text").attr("x", x(medianX) + 4).attr("y", M.top + FONT_PX).style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted).text(`median ${fmtMetric(xm, medianX)}`);
    }
    if (medianY !== null) {
      medians.append("line").attr("x1", M.left).attr("x2", W - M.right).attr("y1", y(medianY)).attr("y2", y(medianY)).style("stroke", TOKENS.muted).style("stroke-dasharray", "4 4");
      medians.append("text").attr("x", W - M.right - 4).attr("y", y(medianY) - 4).attr("text-anchor", "end").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.muted).text(`median ${fmtMetric(ym, medianY)}`);
    }
    dots.attr("cx", (d) => x(d.x)).attr("cy", (d) => y(d.y));
    labels.attr("x", (d) => x(d.x) + (faces ? FACE_R + 3 : 8)).attr("y", (d) => y(d.y) + 4);
    px = visible.map((d) => x(d.x));
    py = visible.map((d) => y(d.y));
    delaunay = Delaunay.from(visible, (_, i) => px[i], (_, i) => py[i]);
    drawFaces();
  };

  const zoomer = zoom<SVGRectElement, unknown>()
    .filter(zoomFilter)
    .scaleExtent([1, 20])
    .extent([
      [M.left, M.top],
      [W - M.right, H - M.bottom],
    ])
    .translateExtent([
      [M.left, M.top],
      [W - M.right, H - M.bottom],
    ])
    .on("zoom", (event: { transform: ZoomTransform }) => {
      draw(event.transform);
      opts.onZoom(event.transform);
    });
  const overlay = root
    .append("rect")
    .attr("x", M.left)
    .attr("y", M.top)
    .attr("width", W - M.left - M.right)
    .attr("height", H - M.top - M.bottom)
    .style("fill", "transparent")
    .style("cursor", "grab")
    .on("pointermove", (event: PointerEvent) => {
      const [mx, my] = pointer(event, root.node());
      const i = visible.length ? delaunay.find(mx, my) : -1;
      if (i < 0 || Math.hypot(px[i] - mx, py[i] - my) > 20) return tip.hide();
      const d = visible[i];
      tip.show(px[i], py[i], [`${d.p.name} (${d.p.team})`, `${SCATTER_INFO[xm].label} ${fmtMetric(xm, d.x)}`, `${SCATTER_INFO[ym].label} ${fmtMetric(ym, d.y)}`]);
    })
    .on("pointerleave", () => tip.hide());
  overlay.call(zoomer);
  // One finger scrolls the page (the filter leaves it alone); two fingers pinch and pan the plot.
  select(svg).style("touch-action", "pan-y");
  draw(opts.transform);
  overlay.call(zoomer.transform, opts.transform);

  return () => {
    zoomer.on("zoom", null);
    redraws.delete(schedule);
    if (pending) cancelAnimationFrame(pending);
    if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    root.remove();
  };
}
