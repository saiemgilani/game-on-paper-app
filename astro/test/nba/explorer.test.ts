import assert from "node:assert/strict";
import { test } from "vitest";
import { gameLabel, stripKeydown, stripLayout } from "../../src/nba/charts/gameStrip";
import { rollingDomain } from "../../src/nba/charts/rollingChart";
import { brushEndHandler, brushOutcome, snapWindow } from "../../src/nba/charts/timeline";
import { lineOf, playerGames } from "../../src/nba/data/aggregate";
import { teamGames } from "../../src/nba/data/games";
import type { PlayerSeason, PlayerStats } from "../../src/nba/data/players";
import { metricValue, RANK_MIN_FG3A, rankSummaries, rankTable } from "../../src/nba/data/ranks";
import { GAME_PRESETS, inWindow, presetGames, selectedView, shotsForGames, visibleGames, withTypedDate, isIsoDate } from "../../src/nba/selection";
import { toLite } from "../../src/nba/data/shots";
import { fixtureGameLogs, fixtureShots } from "./helpers";

const shots = await fixtureShots();
const games = playerGames(shots, teamGames(await fixtureGameLogs()));

const player = (id: number, attempts: number, makes: number, extra: Partial<PlayerSeason> = {}, stats: Partial<PlayerStats> | null = null): PlayerSeason => ({
  person_id: id,
  player_name: `P${id}`,
  team_id: 1,
  team_tricode: "AAA",
  attempts,
  makes,
  fg3a: 0,
  fg3m: 0,
  stats: stats && {
    gp: 70,
    min: 30,
    fga: attempts,
    fg_pct: makes / attempts,
    efg_pct: null,
    ts_pct: null,
    usg_pct: null,
    pie: null,
    pts_pg: null,
    fga_pg: null,
    min_total: null,
    ...stats,
  },
  statsScope: "matching",
  ...extra,
});

test("ranks: competition ranking with ties, 100-FGA eligibility, best first", () => {
  const players = [player(1, 200, 100), player(2, 200, 90), player(3, 400, 180), player(4, 300, 150), player(5, 99, 90)];
  const table = rankTable(players, "fgPct");
  assert.deepEqual(table.map((r) => [r.person_id, r.rank]), [
    [1, 1],
    [4, 1],
    [2, 3],
    [3, 3],
  ]);
  assert.ok(!table.some((r) => r.person_id === 5), "under 100 FGA is not ranked");
  assert.deepEqual(rankTable(players, "fga").map((r) => r.rank), [1, 2, 3, 3]);
});

test("ranks: stats first, shots otherwise; 3P% needs 50 threes; TS% needs a stats row", () => {
  const withStats = player(1, 200, 90, {}, { fg_pct: 0.5, ts_pct: 0.6 });
  assert.equal(metricValue(withStats, "fgPct"), 0.5, "season stats win over shots");
  assert.equal(metricValue(player(2, 200, 90), "fgPct"), 0.45);
  assert.equal(metricValue(player(2, 200, 90), "tsPct"), null);
  assert.equal(metricValue(withStats, "tsPct"), 0.6);
  assert.equal(metricValue(player(3, 200, 90, { fg3a: RANK_MIN_FG3A - 1, fg3m: 40 }), "fg3Pct"), null);
  assert.equal(metricValue(player(3, 200, 90, { fg3a: 100, fg3m: 40 }), "fg3Pct"), 0.4);
  const efg = player(4, 200, 90, { fg3a: 60, fg3m: 20 });
  assert.equal(metricValue(efg, "efgPct"), lineOf(efg).efgPct);
});

test("rank summaries: his row, N, and the top five", () => {
  const players = Array.from({ length: 8 }, (_, i) => player(i + 1, 100 + i * 10, 50));
  const [fga] = rankSummaries(players, 1);
  assert.equal(fga.metric, "fga");
  assert.equal(fga.of, 8);
  assert.equal(fga.me?.rank, 8);
  assert.deepEqual(fga.top.map((r) => r.person_id), [8, 7, 6, 5, 4]);
  assert.equal(rankSummaries(players, 99)[0].me, null);
});

test("selection presets: home, away and neutral split the season; neutral is in neither preset", () => {
  const mixed = [
    { game_id: "a", venue: "home" as const, win: true },
    { game_id: "b", venue: "away" as const, win: false },
    { game_id: "c", venue: "neutral" as const, win: true },
  ];
  assert.deepEqual(presetGames(mixed, "home"), ["a"]);
  assert.deepEqual(presetGames(mixed, "away"), ["b"]);
  assert.deepEqual(presetGames(mixed, "wins"), ["a", "c"]);
});

test("selection presets on real games: home/away/neutral and wins/losses partition every game", () => {
  assert.equal(games.length, 24);
  const ids = (p: (typeof GAME_PRESETS)[number]) => new Set(presetGames(games, p));
  assert.equal(ids("all").size, 24);
  assert.equal(ids("none").size, 0);
  const neutral = games.filter((g) => g.venue === "neutral").length;
  assert.equal(ids("home").size + ids("away").size + neutral, 24, "neutral-site games are in neither Home nor Away");
  assert.equal(ids("wins").size + ids("losses").size, games.filter((g) => g.win !== null).length);
  assert.ok([...ids("home")].every((id) => !ids("away").has(id)));
  assert.deepEqual([ids("home").size, ids("wins").size], [13, 6]);
});

test("the date window is inclusive and combines with the selection", () => {
  const all = new Set(games.map((g) => g.game_id));
  const window: [string, string] = [games[3].date, games[7].date];
  const inside = visibleGames(games, all, window);
  assert.ok(inside.length >= 5 && inside.every((g) => inWindow(g.date, window)));
  assert.equal(inside[0].game_id, games[3].game_id);
  assert.equal(visibleGames(games, new Set([games[4].game_id]), window).length, 1);
  assert.equal(visibleGames(games, all, null).length, 24);
  const kept = shotsForGames(shots, new Set(inside.map((g) => g.game_id)));
  assert.equal(kept.length, inside.reduce((a, g) => a + g.attempts, 0));
  assert.equal(shotsForGames(shots, new Set()).length, 0);
});

test("a brush snaps to the first and last game inside it; one over no game is cleared, not left drawn", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  assert.deepEqual(snapWindow(games, d(games[2].date), d(games[5].date)), [games[2].date, games[5].date]);
  assert.equal(snapWindow(games, d("2020-01-01"), d("2020-02-01")), null);
  assert.deepEqual(brushOutcome(games, [d(games[2].date), d(games[5].date)]), { window: [games[2].date, games[5].date], clear: false });
  const gap = [{ date: "2026-02-12" }, { date: "2026-02-19" }]; // the All-Star break
  assert.deepEqual(brushOutcome(gap, [d("2026-02-13"), d("2026-02-18")]), { window: null, clear: true });
  assert.deepEqual(brushOutcome(gap, null), { window: null, clear: false }, "a click that clears the brush");
});

test("typed dates: only a complete in-season date moves the window; partial, empty or outside values change nothing", () => {
  const [first, last] = ["2025-10-22", "2026-04-12"];
  const w: [string, string] = ["2025-12-01", "2026-01-31"];
  // Chromium's field mid-entry: every partial year, an empty field, out of season, not a date.
  for (const v of ["0002-12-01", "0020-12-01", "0202-12-01", "", "2025-10-01", "2026-05-01", "2026-02-30", "12/01/2025"]) {
    assert.equal(withTypedDate(w, 0, v, first, last), w, `From ${JSON.stringify(v)} leaves the window as it was`);
    assert.equal(withTypedDate(w, 1, v, first, last), w, `To ${JSON.stringify(v)}`);
    assert.equal(withTypedDate(null, 0, v, first, last), null, "no window stays no window");
  }
  assert.deepEqual(withTypedDate(null, 0, "2025-12-01", first, last), ["2025-12-01", last], "From alone: to the season's end");
  assert.deepEqual(withTypedDate(null, 1, "2026-01-31", first, last), [first, "2026-01-31"]);
  assert.deepEqual(withTypedDate(w, 0, "2026-02-10", first, last), ["2026-02-10", "2026-02-10"], "a From after To pulls To along, no swap");
  assert.deepEqual(withTypedDate(w, 1, "2025-11-15", first, last), ["2025-11-15", "2025-11-15"]);
  assert.equal(withTypedDate(["2025-10-22", "2026-01-31"], 1, last, first, last), null, "the whole season is no window");
  assert.equal(withTypedDate(w, 0, "2025-12-01", first, last), w, "the same date: the same window object (no re-render)");
  assert.ok(isIsoDate("2024-02-29") && !isIsoDate("2025-02-29") && !isIsoDate("2025-2-01"));
  const g = games[0];
  assert.ok(gameLabel(g).endsWith(` ${g.opponent}${g.win === null ? "" : g.win ? ", win" : ", loss"}, ${g.makes} of ${g.attempts} FG`), gameLabel(g));
});

test("the game strip wraps by width; the rolling axis pads and clamps", () => {
  const { cells, rows } = stripLayout(games, 190);
  assert.equal(rows, Math.ceil(24 / 10));
  assert.ok(cells.every((c) => c.x + 16 <= 190));
  const points = [{ fgPct: 0.42, efgPct: 0.51 }, { fgPct: 0.38, efgPct: null }].map((p, i) => ({ game_id: String(i), date: "2025-11-01", games: 1, attempts: 10, ...p }));
  assert.deepEqual(rollingDomain(points, 0.45), [0.3, 0.6]);
  assert.deepEqual(rollingDomain([], null), [0, 1]);
  assert.deepEqual(rollingDomain([{ ...points[0], fgPct: 0.98, efgPct: 1 }], null), [0.9, 1]);
});

test("brush wiring: the end listener clears a brush over no game, ignores its own moves, reports the window", () => {
  const time = (d: string) => new Date(`${d}T00:00:00Z`);
  // Pixels are days since the first game, so the gap between two games is easy to brush.
  const day0 = time(games[0].date).getTime();
  const invert = (px: number) => new Date(day0 + px * 86_400_000);
  const px = (d: string) => (time(d).getTime() - day0) / 86_400_000;
  let cleared = 0;
  const reported: unknown[] = [];
  const onEnd = brushEndHandler(games, invert, () => (cleared += 1), (w) => reported.push(w));
  const gap = games.findIndex((g, i) => i > 0 && px(g.date) - px(games[i - 1].date) >= 3);
  assert.ok(gap > 0, "the fixture has a gap of 3+ days between games");
  onEnd({ sourceEvent: {}, selection: [px(games[gap - 1].date) + 0.5, px(games[gap].date) - 0.5] });
  assert.deepEqual([cleared, reported], [1, [null]], "no game inside: the brush is cleared and no window reported");
  onEnd({ sourceEvent: {}, selection: [px(games[2].date), px(games[5].date)] });
  assert.deepEqual([cleared, reported.at(-1)], [1, [games[2].date, games[5].date]]);
  onEnd({ selection: null });
  assert.equal(reported.length, 2, "a programmatic move (no sourceEvent) is not the viewer's");
  onEnd({ sourceEvent: {}, selection: null });
  assert.deepEqual([cleared, reported.at(-1)], [1, null], "a click clears the window; nothing left to clear");
});

test("strip wiring: Enter and Space toggle the cell's game and stop Space from scrolling; other keys do nothing", () => {
  const toggled: string[] = [];
  const onKey = stripKeydown((id) => toggled.push(id));
  let prevented = 0;
  const key = (k: string) => ({ key: k, preventDefault: () => (prevented += 1) });
  for (const k of ["Enter", " ", "a", "Tab", "ArrowRight"]) onKey(key(k), { game: games[0] });
  assert.deepEqual(toggled, [games[0].game_id, games[0].game_id]);
  assert.equal(prevented, 2);
});

test("the versus bars follow the selection and the date window, like the other charts", () => {
  const data = { games, shots: shots.map(toLite), league: { fgPct: 0.47 } };
  const all = new Set(games.map((g) => g.game_id));
  const total = (v: ReturnType<typeof selectedView>) => v.versus?.rows.reduce((a, r) => a + r.attempts, 0);
  const full = selectedView(data, all, null);
  assert.equal(total(full), shots.length);
  const window: [string, string] = [games[3].date, games[7].date];
  const part = selectedView(data, all, window);
  assert.equal(total(part), part.shots.length, "versus counts exactly the window's shots");
  assert.ok(part.shots.length < shots.length && part.view?.every((g) => inWindow(g.date, window)));
  const home = new Set(presetGames(games, "home"));
  assert.equal(total(selectedView(data, home, null)), games.filter((g) => home.has(g.game_id)).reduce((a, g) => a + g.attempts, 0));
  assert.deepEqual(selectedView(data, new Set(), null).versus?.rows, [], "None: no bars");
  const noLogs = selectedView({ ...data, games: null }, all, window);
  assert.deepEqual([noLogs.view, noLogs.versus, noLogs.shots.length], [null, null, shots.length], "no game logs: every shot, no versus");
});
