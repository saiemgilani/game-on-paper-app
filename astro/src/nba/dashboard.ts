import type { Court } from "../basketball/config";
import type { DistanceBarsData } from "./charts/distanceBars";
import type { HexShotChartData } from "./charts/hexShotChart";
import type { ShootingSignatureData } from "./charts/shootingSignature";
import type { SideChartData } from "./charts/sideChart";
import {
  fgPctByDistance,
  hexesVsLeague,
  LEAGUE_PRIOR_ATTEMPTS,
  leagueHexIndex,
  shootingLine,
  statsBySide,
  statsByZone,
  vsLeague,
  ZONES,
  type DistanceBin,
  type LeagueHexIndex,
  type SideBin,
} from "./data/aggregate";
import { COURT } from "./data/court";
import { placeholderSplit, type PlaceholderLocation } from "./data/placeholder";
import type { ShotLite } from "./data/shots";

/**
 * The six charts' data from a set of shots and the league context. Pure and plain-JSON, so the
 * server builds the first render and the player page's game filters rebuild it in the browser.
 */

export const HEX_RADIUS = 15; // tenths of a foot
export const BAR_BIN_FT = 3;

/** League-wide aggregates every dashboard compares against. */
export interface LeagueContext {
  hexIndex: LeagueHexIndex;
  byFoot: DistanceBin[];
  byBin: DistanceBin[];
  sides: SideBin[];
  /** League FG% for the season. */
  fgPct: number | null;
}

export function leagueContext(league: ShotLite[], court: Court = COURT): LeagueContext {
  return {
    hexIndex: leagueHexIndex(league, HEX_RADIUS, court),
    byFoot: fgPctByDistance(league),
    byBin: fgPctByDistance(league, BAR_BIN_FT),
    sides: statsBySide(league, BAR_BIN_FT),
    fgPct: shootingLine(league).fgPct,
  };
}

export interface DashboardData {
  hex: HexShotChartData;
  signature: ShootingSignatureData;
  bars: DistanceBarsData;
  sides: SideChartData;
  /** D29: shots left out of every chart at the placeholder location, and all the subject's shots */
  unlocated?: { count: number; total: number };
}

/**
 * The six charts' data for a set of shots (a player's or a team's) against the league, zoned on `court`. Shots at the league's
 * placeholder location (D29) enter no chart and are counted in `unlocated`; without a placeholder every shot is charted.
 */
export function buildDashboard(subject: ShotLite[], league: LeagueContext, court: Court = COURT, placeholder: PlaceholderLocation | null = null): DashboardData {
  const { located, unlocated } = placeholderSplit(subject, placeholder);
  const zones = statsByZone(located, court);
  return {
    hex: {
      hexes: hexesVsLeague(located, league.hexIndex, LEAGUE_PRIOR_ATTEMPTS, court),
      radius: HEX_RADIUS,
      zones: Object.fromEntries(ZONES.map((z) => [z, { player: zones[z], league: league.hexIndex.zones[z] }])) as HexShotChartData["zones"],
      // only a non-NBA court rides along: the NBA team page's island props stay byte-identical (plan #4's island rule)
      ...(court === COURT ? {} : { court }),
    },
    signature: vsLeague(fgPctByDistance(located), league.byFoot),
    bars: { player: fgPctByDistance(located, BAR_BIN_FT), league: league.byBin, binFt: BAR_BIN_FT },
    sides: { player: statsBySide(located, BAR_BIN_FT), league: league.sides, binFt: BAR_BIN_FT },
    // D29: the note's numbers, only when a shot sat at the placeholder (never for the NBA, which sets none)
    ...(unlocated > 0 ? { unlocated: { count: unlocated, total: subject.length } } : {}),
  };
}
