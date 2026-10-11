import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { fgPctByDistance, hexesVsLeague, LEAGUE_PRIOR_ATTEMPTS, leagueHexIndex, shrunkDiff, statsBySide, vsLeague, ZONES } from "../../src/nba/data/aggregate";
import { THREE_BREAK_Y, toSvg, toSvgLength, zoneAreas, zoneLines } from "../../src/nba/data/court";
import { debounce } from "../../src/nba/debounce";
import { courtViewport } from "../../src/nba/charts/court";
import { barLayout, DISTANCE_BARS_VIEWBOX } from "../../src/nba/charts/distanceBars";
import { colourDiff, layoutHexes } from "../../src/nba/charts/hexShotChart";
import { kernelSmooth, ribbonEnd, RIBBON_MIN_ATTEMPTS, signaturePoints, type ShootingSignatureData } from "../../src/nba/charts/shootingSignature";
import { sideLayout, SIDE_MIN_ATTEMPTS } from "../../src/nba/charts/sideChart";
import { diffColor, DIFF_DOMAIN, TOKENS, wrapText } from "../../src/nba/charts/theme";
import { fixtureShots } from "./helpers";

const league = await fixtureShots();
const topId = [...Map.groupBy(league, (s) => s.person_id)].sort((a, b) => b[1].length - a[1].length)[0][0];
const mine = league.filter((s) => s.person_id === topId);

const rgb = (c: string) => {
  const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(c);
  assert.ok(m, `not rgb: ${c}`);
  return m.slice(1).map(Number);
};

test("diff colours: hot red, cold blue, near-white at 0, clamped, muted without a league figure", () => {
  const [hr, , hb] = rgb(diffColor(0.1));
  const [cr, , cb] = rgb(diffColor(-0.1));
  assert.ok(hr > hb + 80, `+0.1 should be red: ${diffColor(0.1)}`);
  assert.ok(cb > cr + 80, `-0.1 should be blue: ${diffColor(-0.1)}`);
  assert.ok(rgb(diffColor(0)).every((ch) => ch > 230), `0 should be near white: ${diffColor(0)}`);
  assert.equal(diffColor(0.4), diffColor(DIFF_DOMAIN));
  assert.equal(diffColor(null), TOKENS.muted);
});

test("colours shrink toward the league with a 25-attempt prior: 1/1 reads near 0, 20/20 strongly red", () => {
  assert.equal(LEAGUE_PRIOR_ATTEMPTS, 25);
  const one = colourDiff(1, 1, 0.6);
  assert.ok(one !== null && Math.abs(one) < 0.02, `1/1 at a 60% hex: ${one}`);
  assert.ok(rgb(diffColor(one)).every((ch) => ch > 200), `1/1 is near white: ${diffColor(one)}`);
  const twenty = colourDiff(20, 20, 0.45);
  assert.ok(twenty !== null && twenty > DIFF_DOMAIN, `20/20 at a 45% hex: ${twenty}`);
  assert.equal(diffColor(twenty), diffColor(DIFF_DOMAIN), "20/20 is full red");
  assert.equal(shrunkDiff(10, 20, 0.5), 0, "at the league rate the diff is 0");
  assert.equal(colourDiff(3, 5, null), null);
});

test("hex marks stay in the court viewport, sized by a capped sqrt scale, rim hex at the bottom centre", () => {
  const radius = 15;
  const v = courtViewport();
  const { marks, cap, size } = layoutHexes(hexesVsLeague(mine, leagueHexIndex(league, radius)), radius, v);
  assert.ok(marks.length > 20);
  // Whole hexes, sideline and baseline ones included (the court viewport is padded).
  assert.ok(marks.every((m) => m.cx - m.r >= 0 && m.cx + m.r <= v.width && m.cy + m.r <= v.height), "a hex is clipped");
  const edge = layoutHexes([{ ...marks[0].hex, x: 259.8, y: -45, attempts: cap }], radius, v).marks[0];
  assert.ok(edge.cx + edge.r <= v.width && edge.cy + edge.r <= v.height, "the outermost hex column is whole");
  assert.ok(marks.every((m, i) => i === 0 || marks[i - 1].hex.attempts <= m.hex.attempts), "drawn smallest first");
  assert.equal(size(cap * 10), toSvgLength(radius, v), "size is capped at the hex radius");
  assert.ok(Math.abs(size(cap / 4) - toSvgLength(radius, v) / 2) < 1e-9, "sqrt scale");
  const busiest = marks[marks.length - 1];
  const rim = toSvg({ x: 0, y: 0 }, v);
  assert.ok(Math.hypot(busiest.cx - rim.x, busiest.cy - rim.y) < 30, `busiest hex at ${busiest.cx},${busiest.cy}`);
});

test("hex fills use the shrunk difference, not the raw one", () => {
  const v = courtViewport();
  const { marks } = layoutHexes(hexesVsLeague(mine, leagueHexIndex(league, 15)), 15, v);
  for (const m of marks) assert.equal(m.fill, diffColor(colourDiff(m.hex.makes, m.hex.attempts, m.hex.leagueFgPct)));
  const oneForOne = { ...marks[0].hex, makes: 1, attempts: 1, fgPct: 1, leagueFgPct: 0.4 };
  const [mark] = layoutHexes([oneForOne], 15, v).marks;
  assert.equal(mark.fill, diffColor(shrunkDiff(1, 1, 0.4)));
  assert.notEqual(mark.fill, diffColor(0.6), "raw +60 points would be full red");
});

test("hexes carry the league FG% of the same hex (or the zone when the league hex is thin)", () => {
  const hexes = hexesVsLeague(mine, leagueHexIndex(league, 15), 1);
  assert.ok(hexes.every((h) => h.leagueFgPct !== null && h.leagueFgPct >= 0 && h.leagueFgPct <= 1));
  const self = hexesVsLeague(league, leagueHexIndex(league, 15), 1);
  assert.ok(self.every((h) => h.leagueFgPct === h.fgPct), "a player compared with himself has zero diff");
});

test("kernel smoothing is a weighted local mean", () => {
  assert.deepEqual(kernelSmooth([0.5, 0.5, 0.5], [1, 2, 3], 1), [0.5, 0.5, 0.5]);
  const s = kernelSmooth([1, 0, 0, 0, 0, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0, 0, 0, 0], 0.9);
  assert.equal(s[0], 1);
  assert.equal(s[8], 0, "no weight in reach -> 0");
});

/** Synthetic 1-ft bins 0..35 with the given attempts/makes per foot and a flat league rate. */
function bins(attempts: (d: number) => number, makes: (d: number) => number, league = 0.5): ShootingSignatureData {
  return Array.from({ length: 36 }, (_, d) => {
    const a = attempts(d);
    const m = makes(d);
    const fgPct = a ? m / a : null;
    return { distance: d, attempts: a, makes: m, fgPct, share: a / 100, leagueFgPct: league, diff: fgPct === null ? null : fgPct - league };
  });
}

test("the signature leaves a gap where the player took no shots (never 0%)", () => {
  // 20 a foot at 0-5 and 21-26 ft, nothing in between: 9-17 ft must be a gap, not a 0% ribbon.
  const data = bins((d) => (d <= 5 || (d >= 21 && d <= 26) ? 20 : 0), (d) => (d <= 5 || (d >= 21 && d <= 26) ? 10 : 0));
  const points = signaturePoints(data);
  for (const p of points.filter((q) => q.distance >= 9 && q.distance <= 17)) {
    assert.equal(p.fgPct, null, `gap at ${p.distance} ft`);
    assert.equal(p.colourDiff, null);
  }
  const at2 = points.find((p) => p.distance === 2);
  assert.ok(at2 && at2.fgPct !== null && Math.abs(at2.fgPct - 0.5) < 1e-9);
  assert.ok(points.filter((p) => p.distance > 26).every((p) => p.fgPct === null), "nothing past the last busy foot");
});

test("signature colours use the shrunk difference", () => {
  // 6 for 6 at the rim against a 60% league: raw +40 points, shrunk (6 + 25*0.6)/31 - 0.6.
  const data = bins((d) => (d === 0 ? 6 : 0), (d) => (d === 0 ? 6 : 0), 0.6);
  const [p0] = signaturePoints(data);
  assert.ok(p0.colourDiff !== null && Math.abs(p0.colourDiff - shrunkDiff(6, 6, 0.6)) < 1e-9);
  assert.ok(p0.colourDiff < 0.1, "far below the raw +0.4");
});

test("signature points every 0.25 ft; the ribbon ends at the last foot with 5+ attempts", () => {
  const bins = vsLeague(fgPctByDistance(mine), fgPctByDistance(league));
  const points = signaturePoints(bins);
  assert.equal(points.length, 141);
  assert.equal(points[4].distance, 1);
  assert.ok(points.every((p) => p.fgPct === null || (p.fgPct >= 0 && p.fgPct <= 1)));
  const end = ribbonEnd(bins);
  assert.ok(end !== null);
  assert.ok(bins[end].attempts >= RIBBON_MIN_ATTEMPTS);
  assert.ok(bins.slice(end + 1).every((b) => b.attempts < RIBBON_MIN_ATTEMPTS));
  assert.equal(ribbonEnd(bins.map((b) => ({ ...b, attempts: 4 }))), null);
});

test("distance bars: 12 three-foot groups, bars inside their band, FG% on a 0-1 axis", () => {
  const data = { player: fgPctByDistance(mine, 3), league: fgPctByDistance(league, 3), binFt: 3 };
  const fg = barLayout(data, "fgPct");
  assert.equal(fg.yMax, 1);
  assert.equal(fg.groups.length, 12);
  assert.equal(fg.groups[0].label, "0-2");
  const bars = fg.groups.flatMap((g) => g.bars.map((b) => ({ g, b })));
  const pxPerUnit = Math.max(...bars.map(({ b }) => (b.value ? b.height / b.value : 0)));
  assert.ok(pxPerUnit > 0 && pxPerUnit < DISTANCE_BARS_VIEWBOX.height);
  for (const { g, b } of bars) {
    assert.ok(b.x >= g.x - 1e-9 && b.x + b.width <= g.x + g.width + 1e-9);
    if (b.value !== null) assert.ok(Math.abs(b.height - b.value * pxPerUnit) < 1e-6, "bar height is proportional to its value");
  }
  const share = barLayout(data, "share");
  assert.ok(share.yMax > Math.max(...data.player.map((b) => b.share)));
});

test("side FG% bars need 5 attempts; shares do not", () => {
  const data = { player: statsBySide(mine, 3), league: statsBySide(league, 3), binFt: 3 };
  const { rows } = sideLayout(data, "fgPct");
  for (const r of rows) {
    for (const b of r.bars) {
      const n = r.player[b.side].attempts;
      if (n < SIDE_MIN_ATTEMPTS) assert.equal(b.value, null, `${r.label} ${b.side}: ${n} attempts`);
      else assert.equal(b.value, r.player[b.side].fgPct);
    }
  }
  assert.ok(rows.some((r) => r.bars.some((b) => b.value === null && r.player[b.side].attempts > 0)), "the cutoff bites somewhere");
});

test("resize redraws are debounced: one call 150 ms after the last change", () => {
  vi.useFakeTimers();
  try {
    const calls: number[] = [];
    const set = debounce((w: number) => calls.push(w), 150);
    for (const w of [300, 310, 320, 330]) {
      set(w);
      vi.advanceTimersByTime(40);
    }
    assert.deepEqual(calls, []);
    vi.advanceTimersByTime(150);
    assert.deepEqual(calls, [330]);
    set(400);
    set.cancel();
    vi.advanceTimersByTime(500);
    assert.deepEqual(calls, [330], "cancel drops a pending call");
  } finally {
    vi.useRealTimers();
  }
});

test("side bars mirror around the centre column and shares add to 1", () => {
  const data = { player: statsBySide(mine, 3), league: statsBySide(league, 3), binFt: 3 };
  const { rows } = sideLayout(data, "share");
  const lefts = rows.map((r) => r.bars[0]);
  const rights = rows.map((r) => r.bars[2]);
  const leftEdge = Math.max(...lefts.map((b) => b.x + b.width));
  assert.ok(lefts.every((b) => Math.abs(b.x + b.width - leftEdge) < 1e-9), "left bars end at the centre column");
  assert.ok(rights.every((b) => b.x === rights[0].x), "right bars start at the centre column");
  assert.ok(rights[0].x > leftEdge);
  const total = rows.flatMap((r) => r.bars).reduce((a, b) => a + (b.value ?? 0), 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `shares sum to ${total}`);
});

test("zone areas: one per zone, labels inside the court, corners set vertically", () => {
  const v = courtViewport(324);
  const areas = zoneAreas(v);
  assert.deepEqual(areas.map((a) => a.zone), [...ZONES]);
  assert.ok(areas.every((a) => a.label.x > 0 && a.label.x < v.width && a.label.y > 0 && a.label.y < v.height));
  assert.deepEqual(areas.filter((a) => a.vertical).map((a) => a.zone), ["corner_3_left", "corner_3_right"]);
  assert.equal((areas[1].d.match(/Z/g) ?? []).length, 2, "the paint is the lane minus the restricted circle");
});

test("labels wrap to the width and bar labels never collide", () => {
  assert.ok(wrapText("colour shrunk toward the league rate (25-attempt prior)", 300).every((l) => l.length * 6.2 <= 300));
  for (const width of [324, 500, 700]) {
    const data = { player: fgPctByDistance(mine, 1), league: fgPctByDistance(league, 1), binFt: 1 };
    const shown = barLayout(data, "share", width).groups.filter((g) => g.showLabel);
    for (let i = 1; i < shown.length; i++) {
      const gap = shown[i].x - shown[i - 1].x;
      assert.ok(gap >= shown[i].label.length * 6.2, `labels collide at ${width}px`);
    }
  }
});

test("zone outlines add the corner breaks at the arc height", () => {
  const v = courtViewport();
  const names = zoneLines(v).map((l) => l.name);
  assert.deepEqual(names, ["paint", "restricted-area", "three-point-line", "corner-break-left", "corner-break-right"]);
  const y = (v.top - THREE_BREAK_Y) * v.scale;
  assert.ok(zoneLines(v).at(-1)?.d.includes(`,${y.toFixed(2)}`));
});

test("dark mode centres on a grey near the card surface; ends stay red and blue; light keeps RdBu", () => {
  const [r, g, b] = rgb(diffColor(0, "dark"));
  assert.ok(Math.max(r, g, b) < 70 && Math.max(r, g, b) - Math.min(r, g, b) < 6, `dark centre ${diffColor(0, "dark")}`);
  const [hr, , hb] = rgb(diffColor(0.1, "dark"));
  const [cr, , cb] = rgb(diffColor(-0.1, "dark"));
  assert.ok(hr > hb + 60 && cb > cr + 60, "dark ends are red and blue");
  assert.equal(diffColor(0.4, "dark"), diffColor(DIFF_DOMAIN, "dark"), "same ±15 domain, clamped");
  assert.equal(diffColor(0.05), diffColor(0.05, "light"));
  assert.notEqual(diffColor(0, "dark"), diffColor(0, "light"));
});
