import type { Zone } from "./aggregate";
import type { Court, CourtEra } from "../../basketball/config";

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

/**
 * The WNBA court from 2013 (2026 WNBA Official Rule Book, Rule No. 1 Section I): the NBA's frame, lane, free-throw line,
 * 4 ft restricted area and corner lines (36" from the sidelines), with a 22' 1 3/4" arc.
 */
export const WNBA_COURT = { ...COURT, threeRadius: ((22 * 12 + 1.75) / 12) * 10 } as const;
/**
 * The WNBA's earlier courts (plan #3 Task 5, sdv-db WNBA_COURTS, which zones the dashboards with the same figures): a 12 ft
 * lane and a 19'9" arc through 2003, then a 16 ft lane and a 20'6.25" arc through 2012 (Seattle Times, 2003-12-18, "WNBA to
 * have wider lane, extended three-point line"). Before 2013 the line is one arc meeting straight corner lines at the rim's
 * depth, so the corner x is the radius and threeBreakY is 0. `/ 1.2` turns inches into tenths of a foot, as sdv-db does.
 */
export const WNBA_COURT_1997 = { ...COURT, laneHalfWidth: 60, threeRadius: 197.5, threeCornerX: 197.5 } as const;
export const WNBA_COURT_2004 = { ...COURT, threeRadius: (20 * 12 + 6.25) / 1.2, threeCornerX: (20 * 12 + 6.25) / 1.2 } as const;
/**
 * D32 (resolution R5): the season the WNBA adopted the restricted-area arc and its radius in tenths, as plan #3 Task 5
 * recorded them in sdv-db's WNBA_COURTS (WNBA_RESTRICTED_FROM / WNBA_RESTRICTED_RADIUS; its comment cites the source, the
 * WNBA rules release of 2012-12-13; spec §3.3 names the season). Copied from test/fixtures/wnba/sdv_db_wnba_courts.json,
 * never researched here: before `from` no arc is drawn or zoned.
 */
export const WNBA_RESTRICTED_AREA = { from: 2013, radius: 40 } as const;

/** Feet + inches -> legacy tenths of a foot. */
const ft = (f: number, i = 0) => (f + i / 12) * 10;
/** The NCAA three-point arc from 2019-20 (men) / 2021-22 (women): 22' 1 3/4" (Rule 1 Sec. 7 Art. 1), sdv-db's NEW_COURT radius. */
export const NCAA_ARC_NEW = ft(22, 1.75);
/**
 * Owner ruling D45 / resolution R1 (amended by the owner 2026-10-12): the NCAA corner three, ONE constant in sdv-db (plan #7's
 * NEW_COURT.three_corner_x) and GOP (plans #8-#11): the rulebook's "21 feet, 7 7/8 inches in the corners" (NCAA Men's 2026-27 and
 * Women's 2025-26 and 2026-27 Rules Books, Rule 1 Sec. 7 Art. 1, p. 20) = 216.5625 tenths. Never changed on one side.
 */
export const NCAA_CORNER_X = (21 * 12 + 7.875) / 1.2;
const ncaa = (arc: number, corner: number, restricted: number) =>
  ({ ...COURT, laneHalfWidth: 60, threeRadius: arc, threeCornerX: corner, restrictedRadius: restricted }) as const;
/**
 * The NCAA men's court by season (END year), the NBA frame otherwise (rim 5' 3" off the end line, free-throw line 15' from the
 * backboard). NCAA Rules Book, Rule 1: 12' lane (Sec. 6 Art. 1); three-point arc 22' 1 3/4" from 2019-20 with 21' 7 7/8" corners
 * (Sec. 7 Art. 1; NCAA_ARC_NEW, NCAA_CORNER_X); 20' 9" from 2008-09 and 19' 9" before, each a full arc whose straight lines meet
 * the end line at its radius; restricted arc (D32; eras owned by plan #7's sdv-db NCAA_RESTRICTED, mirrored per R5; Sec. 8 keeps
 * "a radius of 4 feet") 3' from 2011-12, 4' from 2015-16, none before (radius 0 draws and zones nothing). Men's dates; plan #10
 * builds the women's eras from the same two constants (22' 1 3/4" from 2021-22).
 */
export const NCAA_COURTS: readonly CourtEra[] = [
  { from: 2003, court: ncaa(ft(19, 9), ft(19, 9), 0) },
  { from: 2009, court: ncaa(ft(20, 9), ft(20, 9), 0) },
  { from: 2012, court: ncaa(ft(20, 9), ft(20, 9), 30) },
  { from: 2016, court: ncaa(ft(20, 9), ft(20, 9), 40) },
  { from: 2020, court: ncaa(NCAA_ARC_NEW, NCAA_CORNER_X, 40) },
];

/** Height where the corner three meets the arc (NBA ~89.5, i.e. ~9 ft above the rim line). */
export const threeBreakY = (court: Court = COURT) => Math.sqrt(court.threeRadius ** 2 - court.threeCornerX ** 2);
export const THREE_BREAK_Y = threeBreakY(COURT);

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

// ponytail: the frame (50 ft wide, rim 63 in off the baseline) is every league's; only the markings vary
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
export function courtLines(v: Viewport, court: Court = COURT): CourtLine[] {
  const { halfWidth: w, baselineY: base, halfCourtY: half, laneHalfWidth: lane, freeThrowY: ft } = court;
  const cornerAngle = Math.atan2(threeBreakY(court), court.threeCornerX);
  const lines: CourtLine[] = [
    { name: "boundary", d: path([{ x: -w, y: v.top }, { x: -w, y: base }, { x: w, y: base }, { x: w, y: v.top }], v) },
    { name: "half-court", d: path([{ x: -w, y: half }, { x: w, y: half }], v) },
    { name: "centre-circle", d: path(arc(0, half, court.circleRadius, Math.PI, 2 * Math.PI), v) },
    { name: "paint", d: path([{ x: -lane, y: base }, { x: -lane, y: ft }, { x: lane, y: ft }, { x: lane, y: base }], v) },
    { name: "free-throw-circle", d: path(arc(0, ft, court.circleRadius, 0, Math.PI), v) },
    { name: "free-throw-circle-inner", d: path(arc(0, ft, court.circleRadius, Math.PI, 2 * Math.PI), v), dashed: true },
    { name: "restricted-area", d: path(arc(0, 0, court.restrictedRadius, 0, Math.PI), v) },
    {
      name: "backboard",
      d: path([{ x: -court.backboardHalfWidth, y: court.backboardY }, { x: court.backboardHalfWidth, y: court.backboardY }], v),
    },
    { name: "rim", d: path(arc(0, 0, court.rimRadius, 0, 2 * Math.PI, 24), v, true) },
    {
      name: "three-point-line",
      d: path(
        [
          { x: -court.threeCornerX, y: base },
          ...arc(0, 0, court.threeRadius, Math.PI - cornerAngle, cornerAngle, 64),
          { x: court.threeCornerX, y: base },
        ],
        v,
      ),
    },
  ];
  // D32: no restricted-area arc before a league adopted it (restrictedRadius 0); the NBA's 40 keeps every line
  return lines.filter((l) => l.name !== "restricted-area" || court.restrictedRadius > 0);
}

/** Zone boundaries for `zoneOf`: restricted arc, paint, three-point line and the corner breaks. */
export function zoneLines(v: Viewport, court: Court = COURT): CourtLine[] {
  const keep = new Set(["restricted-area", "paint", "three-point-line"]);
  const breaks = [-1, 1].map((side) => ({
    name: side < 0 ? "corner-break-left" : "corner-break-right",
    d: path(
      [
        { x: side * court.threeCornerX, y: threeBreakY(court) },
        { x: side * court.halfWidth, y: threeBreakY(court) },
      ],
      v,
    ),
  }));
  return [...courtLines(v, court).filter((l) => keep.has(l.name)), ...breaks];
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
export function zoneAreas(v: Viewport, court: Court = COURT): ZoneArea[] {
  const { halfWidth: w, baselineY: base, laneHalfWidth: lane, freeThrowY: ft, threeCornerX: cx } = court;
  const b = threeBreakY(court);
  const cornerAngle = Math.atan2(b, cx);
  const rim = arc(0, 0, court.restrictedRadius, 0, 2 * Math.PI, 48);
  // D32: a league that had not adopted the restricted-area arc (restrictedRadius 0) has no such zone; the paint is whole
  const hasArc = court.restrictedRadius > 0;
  const paint = [
    { x: -lane, y: base },
    { x: -lane, y: ft },
    { x: lane, y: ft },
    { x: lane, y: base },
  ];
  const insideThree = [{ x: -cx, y: base }, ...arc(0, 0, court.threeRadius, Math.PI - cornerAngle, cornerAngle, 64), { x: cx, y: base }];
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
    ...arc(0, 0, court.threeRadius, cornerAngle, Math.PI - cornerAngle, 64),
  ];
  const at = (x: number, y: number) => toSvg({ x, y }, v);
  const cornerLabelX = (w + cx) / 2;
  // 20 tenths up the strip, or halfway up a strip shorter than that (a WNBA court before 2013 breaks at the rim line, y = 0)
  const cornerLabelY = b > 20 ? 20 : (base + b) / 2;
  const areas: ZoneArea[] = [
    { zone: "restricted_area", d: path(rim, v, true), label: at(0, 8), vertical: false },
    { zone: "paint", d: path(paint, v, true) + (hasArc ? path(rim, v, true) : ""), label: at(0, 95), vertical: false },
    { zone: "mid_range", d: path(insideThree, v, true) + path(paint, v, true), label: at(0, 185), vertical: false },
    { zone: "corner_3_left", d: path(corner(-1), v, true), label: at(-cornerLabelX, cornerLabelY), vertical: true },
    { zone: "corner_3_right", d: path(corner(1), v, true), label: at(cornerLabelX, cornerLabelY), vertical: true },
    { zone: "above_break_3", d: path(aboveBreak, v, true), label: at(0, 285), vertical: false },
  ];
  return areas.filter((a) => hasArc || a.zone !== "restricted_area");
}
