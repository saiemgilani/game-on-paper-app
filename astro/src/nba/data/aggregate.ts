import { hexbin } from "d3-hexbin";
import type { Court } from "../../basketball/config";
import { COURT, threeBreakY } from "./court";
import { gameKey, type GameInfo } from "./games";
import type { Shot, ShotLite } from "./shots";

/** Pure aggregations over shots, all in the legacy frame (tenths of a foot) or in feet. */

export interface Split {
  attempts: number;
  makes: number;
  fgPct: number | null;
}

const made = (s: Pick<Shot, "shot_result">) => s.shot_result === "Made";

function split(attempts: number, makes: number): Split {
  return { attempts, makes, fgPct: attempts > 0 ? makes / attempts : null };
}

function tally(shots: Pick<Shot, "shot_result">[]): Split {
  let makes = 0;
  for (const s of shots) if (made(s)) makes += 1;
  return split(shots.length, makes);
}

/** Field goals with the three-point part, the inputs to FG%, eFG% and 3P%. */
export interface FieldGoals {
  attempts: number;
  makes: number;
  fg3a: number;
  fg3m: number;
}

export interface ShootingLine extends FieldGoals {
  fgPct: number | null;
  /** (FGM + 0.5 * 3PM) / FGA */
  efgPct: number | null;
  fg3Pct: number | null;
}

export function lineOf(fg: FieldGoals): ShootingLine {
  const { attempts, makes, fg3a, fg3m } = fg;
  return {
    ...fg,
    fgPct: attempts ? makes / attempts : null,
    efgPct: attempts ? (makes + 0.5 * fg3m) / attempts : null,
    fg3Pct: fg3a ? fg3m / fg3a : null,
  };
}

export function countFieldGoals(shots: Pick<Shot, "shot_result" | "shot_value">[]): FieldGoals {
  const fg = { attempts: 0, makes: 0, fg3a: 0, fg3m: 0 };
  for (const s of shots) addShot(fg, s);
  return fg;
}

/** Add one shot to running field-goal counts. */
export function addShot(fg: FieldGoals, s: Pick<Shot, "shot_result" | "shot_value">): void {
  fg.attempts += 1;
  if (made(s)) fg.makes += 1;
  if (s.shot_value === 3) {
    fg.fg3a += 1;
    if (made(s)) fg.fg3m += 1;
  }
}

/** Shooting line straight from shots. */
export function shootingLine(shots: Pick<Shot, "shot_result" | "shot_value">[]): ShootingLine {
  return lineOf(countFieldGoals(shots));
}

export interface HexBin extends Split {
  /** Hex centre, legacy frame. */
  x: number;
  y: number;
  meanDistance: number;
  /** The zone most of the hex's attempts fall in. */
  zone: Zone;
}

/** Inside the sidelines and in front of the baseline; the release has a few impossible points (2001-02: x = -16398). */
// ponytail: onCourt keeps COURT: it reads only the frame (halfWidth, baselineY), which every league's court shares
export function onCourt(s: Pick<Shot, "x_legacy" | "y_legacy">): boolean {
  return Math.abs(s.x_legacy) <= COURT.halfWidth && s.y_legacy >= COURT.baselineY;
}

/** d3-hexbin over the legacy frame; `radiusTenths` = 10 is a 1 ft hex. Off-court coordinates are dropped. */
export function hexbinShots(shots: ShotLite[], radiusTenths: number, court: Court = COURT): HexBin[] {
  const bins = hexbin<ShotLite>()
    .x((s) => s.x_legacy)
    .y((s) => s.y_legacy)
    .radius(radiusTenths)(shots.filter(onCourt));
  return bins.map((b) => {
    let distance = 0;
    const zones = new Map<Zone, number>();
    for (const s of b) {
      distance += s.shot_distance;
      const z = zoneOf(s, court);
      zones.set(z, (zones.get(z) ?? 0) + 1);
    }
    const zone = [...zones].reduce((a, c) => (c[1] > a[1] ? c : a))[0];
    // `|| 0` folds d3-hexbin's -0 centres into 0 so equal hexes share one key.
    return { x: b.x || 0, y: b.y || 0, ...tally(b), meanDistance: distance / b.length, zone };
  });
}

/**
 * League attempts behind a hex's league FG% before it falls back to the zone, and the prior
 * (in attempts) that colours shrink toward the league rate with. One number for both.
 */
export const LEAGUE_PRIOR_ATTEMPTS = 25;

/**
 * FG% above/below the league rate L, shrunk toward L by a k-attempt prior:
 * (makes + k*L) / (attempts + k) - L. A 1-for-1 hex reads near 0; 20-for-20 reads strongly hot.
 * For colour only: tooltips and labels show the raw numbers.
 */
export function shrunkDiff(makes: number, attempts: number, league: number, k: number = LEAGUE_PRIOR_ATTEMPTS): number {
  return (makes + k * league) / (attempts + k) - league;
}

export interface HexVsLeague extends HexBin {
  leagueFgPct: number | null;
}

/** A league hex, trimmed to what the comparison reads (it ships to the browser). */
export interface LeagueHex {
  x: number;
  y: number;
  attempts: number;
  fgPct: number | null;
}

/** The league's hexes and zone rates, computed once per season and radius; plain JSON. */
export interface LeagueHexIndex {
  radius: number;
  hexes: LeagueHex[];
  zones: Record<Zone, Split>;
}

export function leagueHexIndex(league: ShotLite[], radiusTenths: number, court: Court = COURT): LeagueHexIndex {
  return {
    radius: radiusTenths,
    hexes: hexbinShots(league, radiusTenths, court).map(({ x, y, attempts, fgPct }) => ({ x, y, attempts, fgPct })),
    zones: statsByZone(league, court),
  };
}

const hexKeys = new WeakMap<LeagueHexIndex, Map<string, LeagueHex>>();
function byCentre(index: LeagueHexIndex): Map<string, LeagueHex> {
  let map = hexKeys.get(index);
  if (!map) hexKeys.set(index, (map = new Map(index.hexes.map((h) => [`${h.x},${h.y}`, h]))));
  return map;
}

/**
 * Player hexes with the league FG% of the same hex: the same radius gives the same centres. A hex
 * the league took fewer than `minLeague` shots from falls back to the league FG% of its zone.
 */
export function hexesVsLeague(player: ShotLite[], league: LeagueHexIndex, minLeague = LEAGUE_PRIOR_ATTEMPTS, court: Court = COURT): HexVsLeague[] {
  const hexes = byCentre(league);
  return hexbinShots(player, league.radius, court).map((h) => {
    const l = hexes.get(`${h.x},${h.y}`);
    return { ...h, leagueFgPct: l && l.attempts >= minLeague ? l.fgPct : league.zones[h.zone].fgPct };
  });
}

export interface DistanceBin extends Split {
  /**
   * First foot in the bin. The release's shot_distance is ROUNDED feet, so a 1-ft bin is centred
   * on this value (it holds true distances in [d - 0.5, d + 0.5)).
   */
  distance: number;
  /** Share of the attempts within `maxFt`. */
  share: number;
}

/**
 * FG% by `shot_distance` (rounded feet) in `binFt` bins from 0 to `maxFt`; longer attempts are left
 * out, as on the 2021 site. Run it on league shots for the league curve.
 */
export function fgPctByDistance(shots: ShotLite[], binFt = 1, maxFt = 35): DistanceBin[] {
  const bins = Array.from({ length: Math.floor(maxFt / binFt) + 1 }, () => ({ attempts: 0, makes: 0 }));
  let total = 0;
  for (const s of shots) {
    if (s.shot_distance > maxFt) continue;
    const b = bins[Math.floor(s.shot_distance / binFt)];
    b.attempts += 1;
    if (made(s)) b.makes += 1;
    total += 1;
  }
  return bins.map((b, i) => ({ distance: i * binFt, ...split(b.attempts, b.makes), share: total ? b.attempts / total : 0 }));
}

export interface DistanceVsLeague extends DistanceBin {
  leagueFgPct: number | null;
  /** Player FG% minus league FG% (fraction, not points), null when either side has no attempts. */
  diff: number | null;
}

/** Pair a player's distance bins with the league's and take the difference; the bins must match exactly. */
export function vsLeague(player: DistanceBin[], league: DistanceBin[]): DistanceVsLeague[] {
  if (player.length !== league.length || player.some((b, i) => b.distance !== league[i].distance)) {
    throw new Error("vsLeague: player and league bins differ (use the same binFt and maxFt)");
  }
  return player.map((b, i) => {
    const leagueFgPct = league[i].fgPct;
    return { ...b, leagueFgPct, diff: b.fgPct !== null && leagueFgPct !== null ? b.fgPct - leagueFgPct : null };
  });
}

export interface SideBin {
  distance: number;
  left: Split;
  centre: Split;
  right: Split;
}

/**
 * Left / centre / right of the hoop by distance. Left is x < -centreHalfWidth (the left of the
 * chart with the hoop at the bottom), right is x > centreHalfWidth, centre is in between. The
 * default 0 keeps the 2021 split (x < 0 left, x > 0 right); x == 0 lands in centre, where the 2021
 * site dropped it. A wider band (e.g. 7.5, the rim) moves ~20% of attempts into centre.
 */
export function statsBySide(shots: ShotLite[], binFt = 1, maxFt = 35, centreHalfWidth = 0): SideBin[] {
  const n = Math.floor(maxFt / binFt) + 1;
  const acc = Array.from({ length: n }, () => ({ left: [0, 0], centre: [0, 0], right: [0, 0] }));
  for (const s of shots) {
    if (s.shot_distance > maxFt) continue;
    const bin = acc[Math.floor(s.shot_distance / binFt)];
    const side = s.x_legacy < -centreHalfWidth ? bin.left : s.x_legacy > centreHalfWidth ? bin.right : bin.centre;
    side[0] += 1;
    if (made(s)) side[1] += 1;
  }
  return acc.map((b, i) => ({
    distance: i * binFt,
    left: split(b.left[0], b.left[1]),
    centre: split(b.centre[0], b.centre[1]),
    right: split(b.right[0], b.right[1]),
  }));
}

export const ZONES = [
  "restricted_area",
  "paint",
  "mid_range",
  "corner_3_left",
  "corner_3_right",
  "above_break_3",
] as const;

export type Zone = (typeof ZONES)[number];

/**
 * Two or three comes from `shot_value` (the scorer's call; coordinates near the line are noisy).
 * Threes at or below the corner break (y <= threeBreakY(court): ~89.5 on the NBA court, 0 on a WNBA court before 2013) are corner threes, split by the sign of x.
 * Twos: within `court.restrictedRadius` of the hoop centre (none when 0) is the restricted area, then the lane
 * (`court.laneHalfWidth` either side) up to the free-throw line is the paint, anything else is mid-range.
 */
export function zoneOf(s: Pick<Shot, "x_legacy" | "y_legacy" | "shot_value">, court: Court = COURT): Zone {
  if (s.shot_value === 3) {
    if (s.y_legacy <= threeBreakY(court)) return s.x_legacy < 0 ? "corner_3_left" : "corner_3_right";
    return "above_break_3";
  }
  // D32: no restricted area before a league adopted the arc (radius 0); sdv-db's _zone_case drops the arm the same way (plan #3)
  if (court.restrictedRadius > 0 && Math.hypot(s.x_legacy, s.y_legacy) <= court.restrictedRadius) return "restricted_area";
  if (Math.abs(s.x_legacy) <= court.laneHalfWidth && s.y_legacy <= court.freeThrowY) return "paint";
  return "mid_range";
}

export function statsByZone(shots: ShotLite[], court: Court = COURT): Record<Zone, Split> {
  const acc = Object.fromEntries(ZONES.map((z) => [z, [0, 0]])) as Record<Zone, [number, number]>;
  for (const s of shots) {
    const z = acc[zoneOf(s, court)];
    z[0] += 1;
    if (made(s)) z[1] += 1;
  }
  return Object.fromEntries(ZONES.map((z) => [z, split(acc[z][0], acc[z][1])])) as Record<Zone, Split>;
}

/** One game of a player's season: his shooting line plus the game's date, opponent, venue and result. */
export type PlayerGame = GameInfo & ShootingLine;

/**
 * The player's games (those he took a shot in) in date order, then game_id. game_id order is not
 * date order, so each game is looked up in `games` (from `teamGames`) under the team he shot for;
 * a game missing there throws, so callers catch it per page rather than show a wrong order.
 */
export function playerGames(shots: (ShotLite & Pick<Shot, "team_id">)[], games: ReadonlyMap<string, GameInfo>): PlayerGame[] {
  const byGame = new Map<string, { team_id: number; fg: FieldGoals }>();
  for (const s of shots) {
    let g = byGame.get(s.game_id);
    if (!g) byGame.set(s.game_id, (g = { team_id: s.team_id, fg: { attempts: 0, makes: 0, fg3a: 0, fg3m: 0 } }));
    addShot(g.fg, s);
  }
  return [...byGame]
    .map(([gameId, g]) => {
      const info = games.get(gameKey(gameId, g.team_id));
      if (!info) throw new Error(`playerGames: no game log for game ${gameId} (team ${g.team_id})`);
      return { ...info, ...lineOf(g.fg) };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.game_id.localeCompare(b.game_id));
}

export interface RollingPoint {
  game_id: string;
  date: string;
  /** Games in the window (fewer than N at the start). */
  games: number;
  attempts: number;
  fgPct: number | null;
  efgPct: number | null;
}

/** Trailing N-game FG% and eFG% over games already in date order (the window pools attempts). */
export function rollingLines(games: PlayerGame[], n: number): RollingPoint[] {
  const size = Math.max(1, Math.floor(n));
  return games.map((g, i) => {
    const window = games.slice(Math.max(0, i - size + 1), i + 1);
    const fg = { attempts: 0, makes: 0, fg3a: 0, fg3m: 0 };
    for (const w of window) {
      fg.attempts += w.attempts;
      fg.makes += w.makes;
      fg.fg3a += w.fg3a;
      fg.fg3m += w.fg3m;
    }
    const line = lineOf(fg);
    return { game_id: g.game_id, date: g.date, games: window.length, attempts: fg.attempts, fgPct: line.fgPct, efgPct: line.efgPct };
  });
}

export interface OpponentLine extends ShootingLine {
  opponent_id: number;
  opponent: string;
  games: number;
}

/** The player's shooting against each opponent, most attempts first. */
export function versusOpponents(games: PlayerGame[]): OpponentLine[] {
  const byOpp = new Map<number, { opponent: string; games: number; fg: FieldGoals }>();
  for (const g of games) {
    let o = byOpp.get(g.opponent_id);
    if (!o) byOpp.set(g.opponent_id, (o = { opponent: g.opponent, games: 0, fg: { attempts: 0, makes: 0, fg3a: 0, fg3m: 0 } }));
    o.games += 1;
    o.fg.attempts += g.attempts;
    o.fg.makes += g.makes;
    o.fg.fg3a += g.fg3a;
    o.fg.fg3m += g.fg3m;
  }
  return [...byOpp]
    .map(([opponent_id, o]) => ({ opponent_id, opponent: o.opponent, games: o.games, ...lineOf(o.fg) }))
    .sort((a, b) => b.attempts - a.attempts || a.opponent.localeCompare(b.opponent));
}
