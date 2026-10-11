import { scaleDiverging, scaleLinear } from "d3-scale";
import { interpolateRdBu } from "d3-scale-chromatic";
import type { Selection } from "d3-selection";
import "d3-transition";
import { LEAGUE_PRIOR_ATTEMPTS } from "../data/aggregate";
import { fmtPts } from "../format";

export type G = Selection<SVGGElement, unknown, null, undefined>;

/** Chart chrome follows the Tailwind tokens in app/globals.css, so light and dark both work. */
export const TOKENS = {
  bg: "var(--bg)",
  surface: "var(--surface)",
  fg: "var(--fg)",
  muted: "var(--muted)",
  line: "var(--line)",
  accent: "var(--accent)",
} as const;

/**
 * Charts render at their measured pixel width (viewBox = CSS pixels), so this is the on-screen
 * text size at every breakpoint.
 */
export const FONT_PX = 11;
/** Average advance of an 11 px sans character, for wrapping and label spacing without measuring. */
export const CHAR_PX = 6.2;

/** FG% minus league FG% saturates at +/-15 points. */
export const DIFF_DOMAIN = 0.15;

/** How hex, zone and signature colours are damped for small samples. */
export const SHRINK_NOTE = `colour shrunk toward the league rate (${LEAGUE_PRIOR_ATTEMPTS}-attempt prior)`;

/** The colour key in words; every diff legend prints it. */
export const DIFF_WORDS = "red: above league · blue: below";

export type ChartTheme = "light" | "dark";

/**
 * The colour scheme the page resolved to: app/globals.css sets --theme per scheme, so this follows
 * prefers-color-scheme without calling matchMedia. Read it in the render (the effect), not at import.
 */
export function chartTheme(el: Element): ChartTheme {
  return getComputedStyle(el).getPropertyValue("--theme").trim() === "dark" ? "dark" : "light";
}

// RdBu reversed = above league red, below league blue (colour-blind safe; the 2021 site's
// red-below / green-above scale was not). Light mode keeps RdBu's near-white centre.
const lightDiff = scaleDiverging<string>((t) => interpolateRdBu(1 - t))
  .domain([-DIFF_DOMAIN, 0, DIFF_DOMAIN])
  .clamp(true);
// Dark mode: the centre is a neutral grey near the card surface (#151515), so an average mark
// recedes and only real differences stand out; the ends are RdBu's mid blue and red.
export const DARK_NEUTRAL = "#303030";
const darkDiff = scaleLinear<string>()
  .domain([-DIFF_DOMAIN, 0, DIFF_DOMAIN])
  .range([interpolateRdBu(0.85), DARK_NEUTRAL, interpolateRdBu(0.15)])
  .clamp(true);

/** Colour for a FG% difference (fraction) in the given theme; null (no league figure) is the muted token. */
export function diffColor(diff: number | null, theme: ChartTheme = "light"): string {
  if (diff === null) return TOKENS.muted;
  return theme === "dark" ? darkDiff(diff) : lightDiff(diff);
}

/** Transition length, 0 when the viewer asked for reduced motion (or outside a browser). */
export function motionMs(ms: number): number {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}


let nextId = 0;
/** Unique ids for gradient defs; charts only render in the browser, so no SSR id clash. */
export const uniqueId = (prefix: string) => `${prefix}-${++nextId}`;

/** Greedy word wrap to `maxWidth` pixels at FONT_PX. */
export function wrapText(text: string, maxWidth: number): string[] {
  const perLine = Math.max(8, Math.floor(maxWidth / CHAR_PX));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > perLine) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const LINE_H = 15;

/** Wrapped, muted text lines starting at (x, y); returns the height used. */
export function drawNotes(g: G, x: number, y: number, maxWidth: number, notes: string[], anchor: "start" | "middle" = "start"): number {
  const lines = notes.flatMap((n) => wrapText(n, maxWidth));
  g.selectAll(null)
    .data(lines)
    .join("text")
    .attr("x", x)
    .attr("y", (_, i) => y + FONT_PX + i * LINE_H)
    .attr("text-anchor", anchor)
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.muted)
    .text((d) => d);
  return lines.length * LINE_H;
}

/**
 * Horizontal FG%-vs-league legend: gradient bar, -15 / 0 / +15 ticks, the key in words and any
 * extra notes. Returns the height used.
 */
export function drawDiffLegend(
  g: G,
  x: number,
  y: number,
  maxWidth: number,
  theme: ChartTheme,
  notes: string[] = [],
  key: [caption: string, words: string] = ["FG% vs league (points)", DIFF_WORDS],
): number {
  const width = Math.min(maxWidth, 240);
  const id = uniqueId("bn-diff");
  const grad = g.append("defs").append("linearGradient").attr("id", id);
  grad
    .selectAll("stop")
    .data([0, 0.25, 0.5, 0.75, 1])
    .join("stop")
    .attr("offset", (t) => `${t * 100}%`)
    .attr("stop-color", (t) => diffColor((t * 2 - 1) * DIFF_DOMAIN, theme));
  g.append("rect").attr("x", x).attr("y", y).attr("width", width).attr("height", 8).attr("rx", 2).style("fill", `url(#${id})`);
  g.selectAll(null)
    .data([-DIFF_DOMAIN, 0, DIFF_DOMAIN])
    .join("text")
    .attr("x", (d) => x + ((d + DIFF_DOMAIN) / (2 * DIFF_DOMAIN)) * width)
    .attr("y", y + 8 + FONT_PX + 2)
    .attr("text-anchor", (d) => (d < 0 ? "start" : d > 0 ? "end" : "middle"))
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.muted)
    .text((d) => (d === 0 ? "0" : fmtPts(d)));
  const used = 8 + FONT_PX + 6;
  return used + drawNotes(g, x, y + used, maxWidth, [...key, ...notes]);
}

/** An in-SVG tooltip: a surface-coloured box of text lines, kept inside `width` x `height`. */
export function tooltip(parent: G, width: number, height: number) {
  const g = parent.append("g").attr("pointer-events", "none").style("display", "none");
  const box = g.append("rect").attr("rx", 4).style("fill", TOKENS.surface).style("stroke", TOKENS.line);
  const text = g.append("text").style("font-size", `${FONT_PX}px`).style("fill", TOKENS.fg);
  return {
    show(x: number, y: number, lines: string[]) {
      g.raise().style("display", null); // above anything drawn after the tooltip was created
      text
        .selectAll("tspan")
        .data(lines)
        .join("tspan")
        .attr("x", 8)
        .attr("dy", (_, i) => (i === 0 ? "1.3em" : "1.35em"))
        .style("font-weight", (_, i) => (i === 0 ? "600" : null))
        .text((d) => d);
      const bb = (text.node() as SVGTextElement).getBBox();
      const w = bb.width + 16;
      const h = bb.height + 10;
      box.attr("width", w).attr("height", h);
      const tx = Math.max(0, x + 12 + w > width ? x - 12 - w : x + 12);
      const ty = Math.min(Math.max(0, y - h - 8), height - h);
      g.attr("transform", `translate(${tx},${ty})`);
    },
    hide() {
      g.style("display", "none");
    },
  };
}

/** Point the <svg> at the pixel box the chart was laid out in. */
export function setViewBox(svg: SVGSVGElement, width: number, height: number): void {
  svg.setAttribute("viewBox", `0 0 ${width} ${Math.ceil(height)}`);
}
