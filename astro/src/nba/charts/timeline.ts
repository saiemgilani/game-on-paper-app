import { max } from "d3-array";
import { brushX } from "d3-brush";
import { scaleLinear, scaleUtc } from "d3-scale";
import { select } from "d3-selection";
import type { PlayerGame } from "../data/aggregate";
import { fmtDate } from "../format";
import type { DateWindow } from "../selection";
import { DEFAULT_WIDTH } from "./court";
import { FONT_PX, setViewBox, TOKENS } from "./theme";

/** A mini timeline of the season's games (bar height = attempts) with a d3-brush date window. */

export interface TimelineOptions {
  width: number;
  window: DateWindow;
  /** Called when the viewer brushes (snapped to the first and last game inside) or clears the brush. */
  onBrush: (window: DateWindow) => void;
}

const H = 76;
const M = { top: 6, right: 10, bottom: 22, left: 10 };
const DAY = 86_400_000;

export const TIMELINE_VIEWBOX = { width: DEFAULT_WIDTH, height: H };

const time = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

/** The games whose dates fall inside [from, to], as a snapped window (null if none). */
export function snapWindow(games: Pick<PlayerGame, "date">[], from: Date, to: Date): DateWindow {
  const inside = games.filter((g) => time(g.date) >= from && time(g.date) <= to);
  return inside.length ? [inside[0].date, inside[inside.length - 1].date] : null;
}

/**
 * What a finished brush gesture means: the snapped window, and whether the drawn brush must be
 * cleared. A brush over dates with no game (the All-Star break) snaps to no window; left drawn it
 * would look applied while every game still counts.
 */
export function brushOutcome(games: Pick<PlayerGame, "date">[], range: [Date, Date] | null): { window: DateWindow; clear: boolean } {
  if (!range) return { window: null, clear: false };
  const window = snapWindow(games, range[0], range[1]);
  return { window, clear: window === null };
}

/**
 * The brush's "end" listener: ignores programmatic moves (no sourceEvent), snaps the viewer's
 * selection to games, clears a brush that covers none (`clear` moves it to null, which is itself
 * programmatic), and reports the window. `invert` maps a pixel to a date.
 */
export function brushEndHandler(
  games: Pick<PlayerGame, "date">[],
  invert: (px: number) => Date,
  clear: () => void,
  onBrush: (window: DateWindow) => void,
): (event: { sourceEvent?: unknown; selection: unknown }) => void {
  return (event) => {
    if (!event.sourceEvent) return; // programmatic moves (re-applying the window) are not the viewer's
    const sel = event.selection as [number, number] | null;
    const { window, clear: mustClear } = brushOutcome(games, sel && [invert(sel[0]), invert(sel[1])]);
    if (mustClear) clear();
    onBrush(window);
  };
}

export function describeTimeline(games: PlayerGame[], window: DateWindow): string {
  if (!games.length) return "No games.";
  const span = `${fmtDate(games[0].date)} to ${fmtDate(games[games.length - 1].date)}`;
  return `${games.length} games from ${span}; ${window ? `window ${fmtDate(window[0])} to ${fmtDate(window[1])}` : "no date window (whole season)"}.`;
}

export function renderTimeline(svg: SVGSVGElement, games: PlayerGame[], { width, window, onBrush }: TimelineOptions): () => void {
  const root = select(svg).append("g");
  setViewBox(svg, width, H);
  if (!games.length) return () => root.remove();
  const bottom = H - M.bottom;
  const x = scaleUtc()
    .domain([new Date(time(games[0].date).getTime() - DAY), new Date(time(games[games.length - 1].date).getTime() + DAY)])
    .range([M.left, width - M.right]);
  const h = scaleLinear()
    .domain([0, max(games, (g) => g.attempts) ?? 1])
    .range([0, bottom - M.top]);

  root
    .append("g")
    .selectAll("rect")
    .data(games)
    .join("rect")
    .attr("x", (g) => x(time(g.date)) - 1.5)
    .attr("width", 3)
    .attr("y", (g) => bottom - h(g.attempts))
    .attr("height", (g) => h(g.attempts))
    .style("fill", TOKENS.muted);
  root.append("line").attr("x1", M.left).attr("x2", width - M.right).attr("y1", bottom).attr("y2", bottom).style("stroke", TOKENS.line);
  const ticks = x.ticks(width < 420 ? 4 : 7);
  root
    .append("g")
    .style("font-size", `${FONT_PX}px`)
    .style("fill", TOKENS.muted)
    .selectAll("text")
    .data(ticks)
    .join("text")
    .attr("x", (d) => x(d))
    .attr("y", bottom + FONT_PX + 5)
    .attr("text-anchor", "middle")
    .text(x.tickFormat(ticks.length, "%b %-d"));

  const brush = brushX<unknown>()
    .extent([
      [M.left, M.top],
      [width - M.right, bottom],
    ])
    .on(
      "end",
      brushEndHandler(
        games,
        (px) => x.invert(px),
        () => brushG.call(brush.move, null),
        onBrush,
      ),
    );
  const brushG = root.append("g");
  brushG.call(brush);
  brushG.select(".selection").style("fill", TOKENS.accent).style("fill-opacity", 0.2).style("stroke", TOKENS.accent);
  if (window) brushG.call(brush.move, [x(time(window[0])) - 3, x(time(window[1])) + 3]);

  return () => {
    brush.on("end", null);
    root.remove();
  };
}
