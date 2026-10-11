import assert from "node:assert/strict";
import { test } from "vitest";
import { paddedDomain, scatterLayout, zoomFilter } from "../../src/nba/charts/scatterChart";
import { lineOf, type PlayerGame } from "../../src/nba/data/aggregate";
import { ACTIVE_DAYS, activeSince, leaderBoards, leaderboard, minAttempts, minThrees, topRows, windowLine, type PlayerGames } from "../../src/nba/data/leaders";
import type { PlayerSeason } from "../../src/nba/data/players";
import { scatterPoints, scatterValues } from "../../src/nba/data/scatter";
import { dotLabels, median, pointValue, randomPair, SCATTER_DEFAULT, SCATTER_METRICS, smallHeadshot, surname } from "../../src/nba/scatterMetrics";
import { hotkey, sortRows, tableReducer, type TableState } from "../../src/nba/table";

test("scatter metrics: defaults are PTS/g and eFG%; random pairs, medians, labels", () => {
  assert.deepEqual(SCATTER_DEFAULT, { x: "ptsPg", y: "efgPct" });
  for (let i = 0; i < 50; i++) {
    const [a, b] = randomPair(() => (i * 0.137) % 1);
    assert.notEqual(a, b);
    assert.ok(SCATTER_METRICS.includes(a) && SCATTER_METRICS.includes(b));
  }
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  const labels = dotLabels(["Jalen Williams", "Ziaire Williams", "Nic Claxton", "Michael Porter Jr.", "Kevin Porter Jr.", "Nene"]);
  assert.deepEqual([...labels.values()], ["J. Williams", "Z. Williams", "Claxton", "M. Porter", "K. Porter", "Nene"], "an initial only where the surname is shared");
  assert.deepEqual(["Michael Porter Jr.", "Gary Payton II", "Marvin Bagley III", "Day'Ron Sharpe", "Nene", "Tim Hardaway Jr"].map(surname), ["Porter", "Payton", "Bagley", "Sharpe", "Nene", "Hardaway"]);
  assert.equal(
    smallHeadshot("https://a.espncdn.com/i/headshots/nba/players/full/4278104.png"),
    "https://a.espncdn.com/combiner/i?img=%2Fi%2Fheadshots%2Fnba%2Fplayers%2Ffull%2F4278104.png&w=96&h=70",
  );
  const same = smallHeadshot("https://a.espncdn.com/i/headshots/nba/players/full/4278104.png");
  assert.equal(smallHeadshot("https://a.espncdn.com/i/headshots/nba/players/full/4278104.png?w=350#x"), same, "query and hash dropped");
  assert.equal(smallHeadshot("/i/headshots/nba/players/full/4278104.png"), same, "a relative href is already a path (and does not throw)");
});

const season = (id: number, attempts: number, makes: number, fg3a: number, fg3m: number, stats: PlayerSeason["stats"] = null): PlayerSeason => ({
  person_id: id,
  player_name: `P${id}`,
  team_id: id === 1 ? 1610612751 : 1610612737,
  team_tricode: id === 1 ? "BKN" : "ATL",
  attempts,
  makes,
  fg3a,
  fg3m,
  stats,
  statsScope: "matching",
});

test("scatter points: 100+ FGA, stats first, shots otherwise, and values in whitelist order", () => {
  const stats = { gp: 70, min: 31, fga: 900, fg_pct: 0.48, efg_pct: 0.55, ts_pct: 0.6, usg_pct: 0.25, pie: 0.12, pts_pg: 21.5, fga_pg: 12.9, min_total: 2170 };
  const points = scatterPoints([season(1, 900, 430, 300, 110, stats), season(2, 150, 60, 10, 4), season(3, 99, 60, 0, 0)], new Map([[1, "https://a.espncdn.com/x.png"]]), 1610612751);
  assert.deepEqual(points.map((p) => p.person_id), [1, 2], "under 100 FGA is not plotted");
  const [nets, other] = points;
  assert.ok(nets.nets && !other.nets);
  assert.equal(pointValue(nets, "ptsPg"), 21.5);
  assert.equal(pointValue(nets, "efgPct"), 0.55, "season stats first");
  const shotsEfg = lineOf(season(2, 150, 60, 10, 4)).efgPct ?? 0;
  assert.equal(pointValue(other, "efgPct"), Math.round(shotsEfg * 1e4) / 1e4, "shots when there is no stats row (rounded to 4 places)");
  assert.equal(pointValue(other, "fg3Pct"), null, "under 50 threes");
  assert.equal(pointValue(other, "tsPct"), null);
  assert.equal(nets.v.length, SCATTER_METRICS.length);
  assert.deepEqual(Object.keys(scatterValues(season(2, 150, 60, 10, 4))).sort(), [...SCATTER_METRICS].sort());
  const { visible, medianX } = scatterLayout(points, "ptsPg", "efgPct");
  assert.deepEqual(visible.map((d) => d.p.person_id), [1], "a point needs both values");
  assert.equal(medianX, 21.5);
  assert.deepEqual(paddedDomain([10, 20]), [9.5, 20.5]);
});

let gameNo = 0;
/** A game with `attempts` shots, `makes` made, `fg3a`/`fg3m` threes. */
const game = (attempts: number, makes: number, fg3a = 0, fg3m = 0): PlayerGame => {
  gameNo += 1;
  return {
    game_id: `00225${String(gameNo).padStart(5, "0")}`,
    date: `2025-11-${String((gameNo % 28) + 1).padStart(2, "0")}`,
    team_id: 1,
    opponent_id: 2,
    opponent: "AAA",
    venue: "home",
    win: true,
    ...lineOf({ attempts, makes, fg3a, fg3m }),
  };
};
/** A player whose i-th game is on day i of the season (so everyone's latest games line up). */
const dayOf = (i: number) => new Date(Date.UTC(2025, 10, 1 + i)).toISOString().slice(0, 10);
const player = (id: number, games: PlayerGame[], team_id = id === 1 ? 1610612751 : 1): PlayerGames => ({
  person_id: id,
  name: `P${id}`,
  team_id,
  team: team_id === 1610612751 ? "BKN" : "AAA",
  games: games.map((g, i) => ({ ...g, date: dayOf(i) })),
});

test("leaderboards: a full N-game window, 5N attempts and 3N threes to qualify", () => {
  assert.deepEqual([minAttempts(5), minThrees(5), minAttempts(20)], [25, 15, 100]);
  const exactly = player(1, Array.from({ length: 5 }, () => game(5, 3, 3, 1))); // 25 FGA, 15 3PA
  const short = player(2, Array.from({ length: 5 }, () => game(4, 4, 3, 3))); // 20 FGA: out
  const fewGames = player(3, Array.from({ length: 4 }, () => game(10, 9))); // 4 games: no full window
  const noThrees = player(4, Array.from({ length: 5 }, () => game(8, 4, 2, 2))); // 10 3PA: out of 3P%
  const players = [exactly, short, fewGames, noThrees];
  assert.deepEqual(leaderboard(players, 5, "fgPct").map((r) => r.person_id), [1, 4], "15/25 = 60% ahead of 20/40 = 50%");
  assert.deepEqual(leaderboard(players, 5, "fg3Pct").map((r) => r.person_id), [1]);
  const w = windowLine(exactly.games, 5);
  assert.deepEqual([w?.games, w?.attempts, w?.makes, w?.fg3a], [5, 25, 15, 15]);
});

test("most improved: window eFG% minus season eFG%, ties share a rank", () => {
  // 10 cold games then 5 hot ones: season eFG% (60 + 0.5*0)/150... computed from all 15 games.
  const cold = Array.from({ length: 10 }, () => game(10, 3));
  const hot = Array.from({ length: 5 }, () => game(10, 7, 4, 2));
  const riser = player(1, [...cold, ...hot]);
  const steady = player(2, Array.from({ length: 15 }, () => game(10, 5)));
  const [first, second] = leaderboard([riser, steady], 5, "improved");
  const window = (35 + 0.5 * 10) / 50;
  const seasonEfg = (30 + 35 + 0.5 * 10) / 150;
  assert.equal(first.person_id, 1);
  assert.ok(Math.abs(first.value - (window - seasonEfg)) < 1e-12);
  assert.ok(Math.abs((first.seasonEfg ?? 0) - seasonEfg) < 1e-12);
  assert.equal(second.value, 0, "no change is a gain of 0");
  const twins = leaderboard([player(5, Array.from({ length: 5 }, () => game(10, 5))), player(6, Array.from({ length: 5 }, () => game(10, 5)))], 5, "fgPct");
  assert.deepEqual(twins.map((r) => r.rank), [1, 1]);
  const boards = leaderBoards([riser, steady], 1610612751, 1);
  assert.equal(boards[5].improved.rows.length, 1);
  assert.equal(boards[5].improved.eligible, 2);
  assert.deepEqual(boards[20].fgPct.rows, [], "15 games cannot fill a 20-game window");
});

test("roster table: click sorts (same column flips), j/k/h/l move and clamp, s sorts the focused column", () => {
  const start: TableState = { sortKey: "fga", sortDir: "desc", row: 0, col: 2 };
  const keys = ["gp", "min", "fga", "fgPct"];
  let s = tableReducer(start, { type: "sort", key: "fga" });
  assert.deepEqual([s.sortKey, s.sortDir], ["fga", "asc"]);
  s = tableReducer(s, { type: "sort", key: "fgPct" });
  assert.deepEqual([s.sortKey, s.sortDir], ["fgPct", "desc"]);
  const move = (st: TableState, key: string) => {
    const a = hotkey(key, 3, keys);
    assert.ok(a && a !== "search");
    return tableReducer(st, a);
  };
  s = move(move(move(start, "j"), "j"), "j");
  assert.equal(s.row, 2, "clamped to the last row");
  s = move(move(s, "k"), "h");
  assert.deepEqual([s.row, s.col], [1, 1]);
  s = move(s, "s");
  assert.deepEqual([s.sortKey, s.sortDir], ["min", "desc"]);
  assert.equal(move({ ...start, row: -1 }, "j").row, 0, "from no focus, j lands on the first row");
  assert.equal(move({ ...start, row: -1 }, "k").row, 0);
  assert.equal(tableReducer({ ...start, row: 0 }, { type: "move", dRow: 1, dCol: 0, rows: 5, cols: 4, from: 3 }).row, 4, "moves from the focused row, not the stored cursor");
  assert.equal(tableReducer({ ...start, row: 9 }, { type: "move", dRow: 0, dCol: 0, rows: 1, cols: 4 }).row, 0, "a zero move clamps a cursor the filter left behind");
  assert.equal(hotkey("/", 3, keys), "search");
  assert.equal(hotkey("x", 3, keys), null);
  assert.deepEqual(tableReducer(start, { type: "move", dRow: 1, dCol: 0, rows: 0, cols: 4 }).row, 0, "no rows: stays at 0");
  const rows = [
    { name: "b", v: 2 },
    { name: "a", v: null },
    { name: "c", v: 2 },
    { name: "d", v: 5 },
  ];
  assert.deepEqual(sortRows(rows, "desc", (r) => r.v).map((r) => r.name), ["d", "b", "c", "a"]);
  assert.deepEqual(sortRows(rows, "asc", (r) => r.v).map((r) => r.name), ["b", "c", "d", "a"], "missing values stay last");
});

test("scatter zoom: one finger scrolls the page, two fingers zoom; mouse as d3's default", () => {
  const touch = (n: number) => ({ type: "touchstart", touches: { length: n } }) as unknown as Event;
  assert.equal(zoomFilter(touch(1)), false);
  assert.equal(zoomFilter(touch(2)), true);
  const mouse = (type: string, extra: Partial<MouseEvent> = {}) => ({ type, ctrlKey: false, button: 0, ...extra }) as unknown as Event;
  assert.equal(zoomFilter(mouse("mousedown")), true);
  assert.equal(zoomFilter(mouse("wheel", { ctrlKey: true })), true, "ctrl+wheel (trackpad pinch) zooms");
  assert.equal(zoomFilter(mouse("mousedown", { ctrlKey: true })), false);
  assert.equal(zoomFilter(mouse("mousedown", { button: 2 })), false);
});

test("leaderboards: active shooters only, ties kept whole at the cut, the Nets below the top rows", () => {
  // Everyone plays 30 games on days 0..29; "gone" stopped on day 10 and "edge" on day 15 (14 days before 29).
  const full = (id: number, games: number, makes: number, team?: number) => player(id, Array.from({ length: games }, () => game(10, makes)), team);
  const gone = full(2, 11, 9);
  const edge = full(3, 16, 8);
  const players = [full(1, 30, 4, 1), gone, edge, full(4, 30, 5), full(5, 30, 5), full(6, 30, 3, 1610612751), full(7, 30, 2, 1610612751)];
  assert.equal(activeSince(players), dayOf(29 - ACTIVE_DAYS));
  assert.equal(activeSince([]), null);
  const ids = (rows: { person_id: number }[]) => rows.map((r) => r.person_id);
  assert.ok(ids(leaderboard(players, 5, "fgPct")).includes(2), "without a cutoff the inactive shooter ranks first");
  const board = leaderboard(players, 5, "fgPct", activeSince(players));
  assert.ok(!ids(board).includes(2), "a window that ended more than 14 days before the latest game is dropped");
  assert.ok(ids(board).includes(3), "exactly 14 days before is still active");
  // Ranks: 3 (80%), then 4 and 5 tied at 50%, then 1, 6, 7.
  assert.deepEqual(board.map((r) => r.rank), [1, 2, 2, 4, 5, 6]);
  assert.deepEqual(ids(topRows(board, 2)), [3, 4, 5], "a tie straddling the cut is kept whole");
  assert.deepEqual(ids(topRows(board, 3)), [3, 4, 5]);
  assert.deepEqual(topRows([], 15), []);
  const boards = leaderBoards(players, 1610612751, 2);
  assert.deepEqual(ids(boards[5].fgPct.rows), [3, 4, 5]);
  assert.deepEqual(ids(boards[5].fgPct.also), [6, 7], "the Nets ranked below the top rows, in rank order");
  assert.equal(boards[5].fgPct.eligible, 6);
});
