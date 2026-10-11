import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ZONES,
  fgPctByDistance,
  hexbinShots,
  lineOf,
  playerGames,
  rollingLines,
  statsBySide,
  statsByZone,
  versusOpponents,
  vsLeague,
  zoneOf,
  type PlayerGame,
} from "../../src/nba/data/aggregate";
import { gameKey, teamGames, type GameInfo } from "../../src/nba/data/games";
import { fixtureGameLogs, fixtureShots, shot } from "./helpers";

const shots = await fixtureShots();
const logs = await fixtureGameLogs();
const NETS = 1610612751;

test("the fixture is 2 000 real Nets attempts from 2025-26", () => {
  assert.equal(shots.length, 2000);
  assert.ok(shots.every((s) => s.team_id === 1610612751 && s.team_tricode === "BKN"));
  assert.equal(shots.filter((s) => s.shot_result === "Made").length, 890);
  assert.equal(new Set(shots.map((s) => s.game_id)).size, 24);
});

test("zones by value, distance and x", () => {
  const cases: [number, number, 2 | 3, string][] = [
    [0, 0, 2, "restricted_area"],
    [0, 39, 2, "restricted_area"],
    [0, 45, 2, "paint"],
    [79, 130, 2, "paint"],
    [85, 100, 2, "mid_range"],
    [0, 200, 2, "mid_range"],
    [-225, 10, 3, "corner_3_left"],
    [225, 85, 3, "corner_3_right"],
    [-225, 95, 3, "above_break_3"],
    [0, 260, 3, "above_break_3"],
  ];
  for (const [x, y, v, zone] of cases) assert.equal(zoneOf({ x_legacy: x, y_legacy: y, shot_value: v }), zone, `${x},${y}`);
});

test("real corner threes sit outside |x| = 220 and every zone adds up", () => {
  const corners = shots.filter((s) => zoneOf(s).startsWith("corner_3"));
  assert.ok(corners.length > 50);
  assert.ok(corners.every((s) => Math.abs(s.x_legacy) >= 215), "corner three inside the line");
  const zones = statsByZone(shots);
  assert.deepEqual(Object.keys(zones), [...ZONES]);
  assert.equal(Object.values(zones).reduce((a, z) => a + z.attempts, 0), 2000);
  assert.ok((zones.restricted_area.fgPct ?? 0) > 0.5, "rim FG% should beat 50%");
  assert.ok((zones.above_break_3.fgPct ?? 1) < 0.45);
});

test("fgPctByDistance bins rounded feet and drops attempts past maxFt", () => {
  const bins = fgPctByDistance([shot(0, 0, 2, true), shot(0, 4, 2, false), shot(0, 100, 2, true), shot(0, 400, 3, false)], 1, 35);
  assert.equal(bins.length, 36);
  assert.deepEqual(bins[0], { distance: 0, attempts: 2, makes: 1, fgPct: 0.5, share: 2 / 3 });
  assert.equal(bins[10].fgPct, 1);
  assert.equal(bins[20].fgPct, null);
  const three = fgPctByDistance(shots, 3, 35);
  assert.equal(three.length, 12);
  const within = shots.filter((s) => s.shot_distance <= 35).length;
  assert.equal(three.reduce((a, b) => a + b.attempts, 0), within);
  assert.ok(Math.abs(three.reduce((a, b) => a + b.share, 0) - 1) < 1e-9);
});

test("vsLeague subtracts the league curve bin by bin", () => {
  const player = fgPctByDistance([shot(0, 0, 2, true), shot(0, 0, 2, true)], 1, 2);
  const league = fgPctByDistance([shot(0, 0, 2, true), shot(0, 0, 2, false), shot(0, 12, 2, true)], 1, 2);
  const out = vsLeague(player, league);
  assert.equal(out[0].diff, 0.5);
  assert.equal(out[1].diff, null);
  assert.equal(out[1].leagueFgPct, 1);
  assert.throws(() => vsLeague(player, fgPctByDistance([], 1, 3)), /bins differ/);
  assert.throws(() => vsLeague(fgPctByDistance([], 2, 4), fgPctByDistance([], 1, 2)), /bins differ/);
});

test("statsBySide: x < 0 left, x > 0 right by default (2021 split); a centre band is opt-in", () => {
  const four = [shot(-3, 0, 2, true), shot(0, 4, 2, false), shot(3, 0, 2, true), shot(4, 0, 2, false)];
  const bins = statsBySide(four, 1, 35);
  assert.deepEqual(bins[0].left, { attempts: 1, makes: 1, fgPct: 1 });
  assert.deepEqual(bins[0].centre, { attempts: 1, makes: 0, fgPct: 0 });
  assert.deepEqual(bins[0].right, { attempts: 2, makes: 1, fgPct: 0.5 });
  const banded = statsBySide(four, 1, 35, 3.5);
  assert.deepEqual(banded[0].centre, { attempts: 3, makes: 2, fgPct: 2 / 3 });
  assert.deepEqual(banded[0].right, { attempts: 1, makes: 0, fgPct: 0 });
  const real = statsBySide(shots);
  const total = real.reduce((a, b) => a + b.left.attempts + b.centre.attempts + b.right.attempts, 0);
  assert.equal(total, shots.filter((s) => s.shot_distance <= 35).length);
});

test("hexbins keep every attempt and stay on the court", () => {
  const bins = hexbinShots(shots, 15);
  assert.ok(bins.length > 50);
  assert.equal(bins.reduce((a, b) => a + b.attempts, 0), 2000);
  assert.equal(bins.reduce((a, b) => a + b.makes, 0), 890);
  assert.ok(bins.every((b) => Math.abs(b.x) <= 270 && b.meanDistance >= 0));
  const rim = bins.reduce((a, b) => (b.attempts > a.attempts ? b : a));
  assert.ok(Math.hypot(rim.x, rim.y) < 30, "the busiest hex is at the rim");
  const offCourt = [shot(0, 0, 2, true), { ...shot(0, 0, 2, true), x_legacy: -16398 }, { ...shot(0, 0, 2, true), y_legacy: -60 }];
  assert.equal(hexbinShots(offCourt, 15).reduce((a, b) => a + b.attempts, 0), 1, "off-court points are dropped");
});

const info = (game_id: string, date: string, extra: Partial<GameInfo> = {}): [string, GameInfo] => [
  gameKey(game_id, NETS),
  { game_id, date, team_id: NETS, opponent_id: 1, opponent: "AAA", venue: "home", win: true, ...extra },
];

test("playerGames orders by date, not game_id, and throws on a game missing from the logs", () => {
  // A Cup group game (low id) played after the opener (higher id), as in 2025-26.
  const games = new Map([info("0022500031", "2025-11-07"), info("0022500080", "2025-10-22"), info("0022500091", "2025-10-24")]);
  const series = playerGames([shot(0, 0, 2, true, "0022500031"), shot(0, 0, 2, false, "0022500080"), shot(0, 0, 3, true, "0022500091")], games);
  assert.deepEqual(series.map((g) => g.game_id), ["0022500080", "0022500091", "0022500031"]);
  assert.deepEqual([series[1].attempts, series[1].fg3m, series[1].efgPct], [1, 1, 1.5]);
  assert.throws(() => playerGames([shot(0, 0, 2, true, "0022599999")], games), /no game log for game 0022599999/);
});

test("the real fixture's games come out in date order, which differs from id order", () => {
  const real = playerGames(shots, teamGames(logs));
  assert.equal(real.length, 24);
  const byDate = real.map((g) => g.date);
  assert.deepEqual(byDate, [...byDate].sort());
  const byId = real.map((g) => g.game_id).sort();
  assert.equal(real.filter((g, i) => g.game_id !== byId[i]).length, 18, "18 of 24 positions differ between id order and date order");
  assert.equal(real[0].date, "2025-10-22");
  assert.equal(real.reduce((a, g) => a + g.attempts, 0), 2000);
});

test("the opponent map pairs each game's two rows (real game logs)", () => {
  const games = teamGames(logs);
  assert.equal(games.size, 48);
  const nets = [...games.values()].filter((g) => g.team_id === NETS);
  assert.equal(nets.length, 24);
  for (const g of nets) {
    assert.notEqual(g.opponent_id, NETS);
    const other = games.get(gameKey(g.game_id, g.opponent_id));
    assert.ok(other && other.opponent === "BKN" && other.opponent_id === NETS && other.date === g.date);
    assert.ok(!(g.venue === "home" && other.venue === "home"), "at most one home side per game");
    if (g.win !== null && other.win !== null) assert.notEqual(g.win, other.win);
  }
  assert.deepEqual([nets.filter((g) => g.venue === "home").length, nets.filter((g) => g.venue === "away").length, nets.filter((g) => g.win).length], [13, 11, 6]);
});

const pg = (game_id: string, attempts: number, makes: number, fg3m = 0, opponent = "AAA", opponent_id = 1): PlayerGame => ({
  game_id,
  date: `2025-11-${game_id.slice(-2)}`,
  team_id: NETS,
  opponent_id,
  opponent,
  venue: "home",
  win: true,
  ...lineOf({ attempts, makes, fg3a: fg3m, fg3m }),
});

test("rollingLines: trailing window, a short start, n longer than the season, n = 1, no games", () => {
  const games = [pg("01", 10, 5), pg("02", 10, 3, 2), pg("03", 0, 0), pg("04", 20, 10)];
  const two = rollingLines(games, 2);
  assert.deepEqual(two.map((p) => p.games), [1, 2, 2, 2]);
  assert.deepEqual(two.map((p) => p.attempts), [10, 20, 10, 20]);
  assert.equal(two[1].fgPct, 8 / 20);
  assert.equal(two[1].efgPct, (8 + 0.5 * 2) / 20);
  assert.equal(two[2].fgPct, 3 / 10, "a 0-attempt game only widens the window");
  assert.deepEqual(rollingLines(games, 10).map((p) => p.games), [1, 2, 3, 4]);
  assert.deepEqual(rollingLines(games, 1).map((p) => p.fgPct), [0.5, 0.3, null, 0.5]);
  assert.deepEqual(rollingLines([], 5), []);
});

test("versusOpponents sums each opponent, most attempts first", () => {
  const rows = versusOpponents([pg("01", 10, 5, 0, "MIA", 2), pg("02", 4, 1, 0, "BOS", 3), pg("03", 8, 4, 1, "MIA", 2)]);
  assert.deepEqual(rows.map((r) => [r.opponent, r.games, r.attempts, r.makes]), [
    ["MIA", 2, 18, 9],
    ["BOS", 1, 4, 1],
  ]);
  assert.equal(rows[0].fgPct, 0.5);
});

test("a game whose two rows both read @ is neutral for both sides", () => {
  const row = (team_id: number, abbr: string, matchup: string, wl: "W" | "L") => ({ game_id: "0022500999", team_id, team_abbreviation: abbr, game_date: "2025-12-16", matchup, wl });
  const neutral = teamGames([row(1610612751, "BKN", "BKN @ SAS", "W"), row(1610612759, "SAS", "SAS @ BKN", "L")]);
  assert.deepEqual([...neutral.values()].map((g) => [g.opponent, g.venue, g.win]), [
    ["SAS", "neutral", true],
    ["BKN", "neutral", false],
  ]);
  const normal = teamGames([row(1610612751, "BKN", "BKN vs. SAS", "W"), row(1610612759, "SAS", "SAS @ BKN", "L")]);
  assert.deepEqual([...normal.values()].map((g) => g.venue), ["home", "away"]);
});

/** The five 2025-26 games whose two log rows both read "@" (copied from player_game_logs_2026). */
const NEUTRAL_2026 = [
  ["0022500147", 1610612765, "DET", "2025-11-01", "DET @ DAL", "W"],
  ["0022500147", 1610612742, "DAL", "2025-11-01", "DAL @ DET", "L"],
  ["0022501229", 1610612753, "ORL", "2025-12-13", "ORL @ NYK", "L"],
  ["0022501229", 1610612752, "NYK", "2025-12-13", "NYK @ ORL", "W"],
  ["0022501230", 1610612760, "OKC", "2025-12-13", "OKC @ SAS", "L"],
  ["0022501230", 1610612759, "SAS", "2025-12-13", "SAS @ OKC", "W"],
  ["0022500578", 1610612763, "MEM", "2026-01-15", "MEM @ ORL", "L"],
  ["0022500578", 1610612753, "ORL", "2026-01-15", "ORL @ MEM", "W"],
  ["0022500602", 1610612763, "MEM", "2026-01-18", "MEM @ ORL", "W"],
  ["0022500602", 1610612753, "ORL", "2026-01-18", "ORL @ MEM", "L"],
] as const;

test("the real 2025-26 neutral-site games (both rows '@') are neutral for both teams", () => {
  const rows = NEUTRAL_2026.map(([game_id, team_id, team_abbreviation, game_date, matchup, wl]) => ({ game_id, team_id, team_abbreviation, game_date, matchup, wl }));
  const games = [...teamGames(rows).values()];
  assert.equal(games.length, 10);
  assert.ok(games.every((g) => g.venue === "neutral"));
  assert.deepEqual(
    games.filter((g) => g.date === "2026-01-18").map((g) => [g.team_id, g.opponent, g.win]),
    [
      [1610612763, "ORL", true],
      [1610612753, "MEM", false],
    ],
  );
});
