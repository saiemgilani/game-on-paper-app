import type { Zone } from "./aggregate";

/**
 * NBA half court in the legacy shot frame (`x_legacy`/`y_legacy`): tenths of a foot, hoop centre
 * at the origin, y growing toward half court, x in [-250, 250]. This module is the ONLY place
 * that turns that frame into pixels; charts draw with `toSvg`, `toSvgLength` and `courtLines`.
 */
export const COURT = {
  halfWidth: 250, // 50 ft wide
  baselineY: -52.5, // rim centre is 63 in (5.25 ft) from the baseline
  halfCourtY: 417.5, // 47 ft from the baseline
  rimRadius: 7.5, // 18 in rim
  backboardY: -12.5, // 4 ft in from the baseline, 15 in behind the rim centre
  backboardHalfWidth: 30, // 6 ft backboard
  laneHalfWidth: 80, // 16 ft lane
  freeThrowY: 137.5, // 19 ft from the baseline, 15 ft from the backboard
  circleRadius: 60, // free-throw and centre circles, 6 ft
  restrictedRadius: 40, // 4 ft arc
  threeCornerX: 220, // 22 ft in the corners
  threeRadius: 237.5, // 23.75 ft arc
} as const;

/** Height where the corner three meets the arc (~89.5, i.e. ~9 ft above the rim line). */
export const THREE_BREAK_Y = Math.sqrt(COURT.threeRadius ** 2 - COURT.threeCornerX ** 2);

export interface Point {
  x: number;
  y: number;
}

/**
 * A pixel box `width` wide showing the court from the baseline up to legacy `top`, hoop at the
 * bottom, with `pad` tenths of a foot of margin beside the sidelines and below the baseline.
 */
export interface Viewport {
  width: number;
  height: number;
  /** Pixels per tenth of a foot. */
  scale: number;
  top: number;
  pad: number;
}

export function viewport(width: number, top: number = COURT.halfCourtY, pad = 0): Viewport {
  const scale = width / (2 * (COURT.halfWidth + pad));
  return { width, height: (top - COURT.baselineY + pad) * scale, scale, top, pad };
}

/** Legacy frame -> SVG pixels. x keeps its sign (x < 0 is the left of the chart); y is flipped. */
export function toSvg(p: Point, v: Viewport): Point {
  return { x: (p.x + COURT.halfWidth + v.pad) * v.scale, y: (v.top - p.y) * v.scale };
}

/** A length in tenths of a foot (a hex radius, a mark size) -> pixels. */
export function toSvgLength(tenths: number, v: Viewport): number {
  return tenths * v.scale;
}

export interface CourtLine {
  name: string;
  /** SVG path in pixels. */
  d: string;
  dashed?: boolean;
}

function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 48): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function path(points: Point[], v: Viewport, close = false): string {
  const d = points
    .map((p, i) => {
      const s = toSvg(p, v);
      return `${i === 0 ? "M" : "L"}${s.x.toFixed(2)},${s.y.toFixed(2)}`;
    })
    .join("");
  return close ? `${d}Z` : d;
}

/** Court markings as pixel paths for `v`, drawn from the legacy-frame geometry above. */
export function courtLines(v: Viewport): CourtLine[] {
  const { halfWidth: w, baselineY: base, halfCourtY: half, laneHalfWidth: lane, freeThrowY: ft } = COURT;
  const cornerAngle = Math.atan2(THREE_BREAK_Y, COURT.threeCornerX);
  return [
    { name: "boundary", d: path([{ x: -w, y: v.top }, { x: -w, y: base }, { x: w, y: base }, { x: w, y: v.top }], v) },
    { name: "half-court", d: path([{ x: -w, y: half }, { x: w, y: half }], v) },
    { name: "centre-circle", d: path(arc(0, half, COURT.circleRadius, Math.PI, 2 * Math.PI), v) },
    { name: "paint", d: path([{ x: -lane, y: base }, { x: -lane, y: ft }, { x: lane, y: ft }, { x: lane, y: base }], v) },
    { name: "free-throw-circle", d: path(arc(0, ft, COURT.circleRadius, 0, Math.PI), v) },
    { name: "free-throw-circle-inner", d: path(arc(0, ft, COURT.circleRadius, Math.PI, 2 * Math.PI), v), dashed: true },
    { name: "restricted-area", d: path(arc(0, 0, COURT.restrictedRadius, 0, Math.PI), v) },
    {
      name: "backboard",
      d: path([{ x: -COURT.backboardHalfWidth, y: COURT.backboardY }, { x: COURT.backboardHalfWidth, y: COURT.backboardY }], v),
    },
    { name: "rim", d: path(arc(0, 0, COURT.rimRadius, 0, 2 * Math.PI, 24), v, true) },
    {
      name: "three-point-line",
      d: path(
        [
          { x: -COURT.threeCornerX, y: base },
          ...arc(0, 0, COURT.threeRadius, Math.PI - cornerAngle, cornerAngle, 64),
          { x: COURT.threeCornerX, y: base },
        ],
        v,
      ),
    },
  ];
}

/** Zone boundaries for `zoneOf`: restricted arc, paint, three-point line and the corner breaks. */
export function zoneLines(v: Viewport): CourtLine[] {
  const keep = new Set(["restricted-area", "paint", "three-point-line"]);
  const breaks = [-1, 1].map((side) => ({
    name: side < 0 ? "corner-break-left" : "corner-break-right",
    d: path(
      [
        { x: side * COURT.threeCornerX, y: THREE_BREAK_Y },
        { x: side * COURT.halfWidth, y: THREE_BREAK_Y },
      ],
      v,
    ),
  }));
  return [...courtLines(v).filter((l) => keep.has(l.name)), ...breaks];
}

export interface ZoneArea {
  zone: Zone;
  /** Filled SVG path in pixels; paint and mid-range have holes, so fill them with fill-rule evenodd. */
  d: string;
  /** Where the zone's label goes, in pixels. */
  label: Point;
  /** Corner strips are narrow: set their label vertically. */
  vertical: boolean;
}

/** The six `zoneOf` zones as fillable areas, cut off at the viewport top. */
export function zoneAreas(v: Viewport): ZoneArea[] {
  const { halfWidth: w, baselineY: base, laneHalfWidth: lane, freeThrowY: ft, threeCornerX: cx } = COURT;
  const b = THREE_BREAK_Y;
  const cornerAngle = Math.atan2(b, cx);
  const rim = arc(0, 0, COURT.restrictedRadius, 0, 2 * Math.PI, 48);
  const paint = [
    { x: -lane, y: base },
    { x: -lane, y: ft },
    { x: lane, y: ft },
    { x: lane, y: base },
  ];
  const insideThree = [{ x: -cx, y: base }, ...arc(0, 0, COURT.threeRadius, Math.PI - cornerAngle, cornerAngle, 64), { x: cx, y: base }];
  const corner = (side: number) => [
    { x: side * w, y: base },
    { x: side * w, y: b },
    { x: side * cx, y: b },
    { x: side * cx, y: base },
  ];
  const aboveBreak = [
    { x: -w, y: b },
    { x: -w, y: v.top },
    { x: w, y: v.top },
    { x: w, y: b },
    ...arc(0, 0, COURT.threeRadius, cornerAngle, Math.PI - cornerAngle, 64),
  ];
  const at = (x: number, y: number) => toSvg({ x, y }, v);
  const cornerLabelX = (w + cx) / 2;
  return [
    { zone: "restricted_area", d: path(rim, v, true), label: at(0, 8), vertical: false },
    { zone: "paint", d: path(paint, v, true) + path(rim, v, true), label: at(0, 95), vertical: false },
    { zone: "mid_range", d: path(insideThree, v, true) + path(paint, v, true), label: at(0, 185), vertical: false },
    { zone: "corner_3_left", d: path(corner(-1), v, true), label: at(-cornerLabelX, 20), vertical: true },
    { zone: "corner_3_right", d: path(corner(1), v, true), label: at(cornerLabelX, 20), vertical: true },
    { zone: "above_break_3", d: path(aboveBreak, v, true), label: at(0, 285), vertical: false },
  ];
}
