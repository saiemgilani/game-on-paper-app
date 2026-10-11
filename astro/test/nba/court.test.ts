import assert from "node:assert/strict";
import { test } from "vitest";
import { COURT, THREE_BREAK_Y, courtLines, toSvg, toSvgLength, viewport, type Point, type Viewport } from "../../src/nba/data/court";

/** Pixel path back to the legacy frame, to check the drawn lines against the geometry. */
function legacyPoints(d: string, v: Viewport): Point[] {
  return [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]) / v.scale - COURT.halfWidth,
    y: v.top - Number(m[2]) / v.scale,
  }));
}

function line(name: string, v: Viewport) {
  const found = courtLines(v).find((l) => l.name === name);
  assert.ok(found, `no ${name} line`);
  return found;
}

test("a 500 px viewport is one pixel per tenth of a foot, baseline to half court", () => {
  const v = viewport(500);
  assert.equal(v.scale, 1);
  assert.equal(v.height, 470);
  assert.equal(viewport(1000).scale, 2);
  assert.equal(toSvgLength(7.5, viewport(1000)), 15);
});

test("the rim is the legacy origin and sits at the bottom centre", () => {
  const v = viewport(500);
  assert.deepEqual(toSvg({ x: 0, y: 0 }, v), { x: 250, y: 417.5 });
  assert.deepEqual(toSvg({ x: -250, y: COURT.halfCourtY }, v), { x: 0, y: 0 });
  assert.deepEqual(toSvg({ x: 250, y: COURT.baselineY }, v), { x: 500, y: 470 });
});

test("corner threes are at |x| = 220 up to y ~ 90; the top of the arc is ~ (0, 240)", () => {
  assert.equal(COURT.threeCornerX, 220);
  assert.ok(THREE_BREAK_Y > 85 && THREE_BREAK_Y <= 90, `break ${THREE_BREAK_Y}`);
  assert.ok(Math.abs(COURT.threeRadius - 240) < 5);
  const v = viewport(1000);
  assert.deepEqual(toSvg({ x: -220, y: 0 }, v), { x: 60, y: 835 });
  assert.deepEqual(toSvg({ x: 0, y: 237.5 }, v), { x: 500, y: 360 });
});

test("the three-point line is two 22 ft corners joined by the 23.75 ft arc", () => {
  const v = viewport(500);
  const pts = legacyPoints(line("three-point-line", v).d, v);
  for (const p of pts) {
    const corner = Math.abs(Math.abs(p.x) - 220) < 0.01 && p.y <= THREE_BREAK_Y + 0.01;
    const onArc = Math.abs(Math.hypot(p.x, p.y) - 237.5) < 0.02;
    assert.ok(corner || onArc, `off the line: ${p.x}, ${p.y}`);
  }
  assert.deepEqual(pts[0], { x: -220, y: COURT.baselineY });
  assert.deepEqual(pts.at(-1), { x: 220, y: COURT.baselineY });
  assert.ok(Math.abs(Math.max(...pts.map((p) => p.y)) - 237.5) < 0.05);
});

test("the rim is a 7.5-tenth circle around the hoop pixel", () => {
  const v = viewport(500);
  for (const p of legacyPoints(line("rim", v).d, v)) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 7.5) < 0.01);
});

test("every court line stays inside the viewport", () => {
  for (const width of [390, 768]) {
    const v = viewport(width);
    for (const l of courtLines(v)) {
      for (const m of l.d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) {
        const [x, y] = [Number(m[1]), Number(m[2])];
        assert.ok(x >= -0.01 && x <= v.width + 0.01 && y >= -0.01 && y <= v.height + 0.01, `${l.name} at ${x},${y}`);
      }
    }
  }
});
