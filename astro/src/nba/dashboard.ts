import type { DistanceBarsData } from "./charts/distanceBars";
import type { HexShotChartData } from "./charts/hexShotChart";
import type { ShootingSignatureData } from "./charts/shootingSignature";
import type { SideChartData } from "./charts/sideChart";
import {
  fgPctByDistance,
  hexesVsLeague,
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

export function leagueContext(league: ShotLite[]): LeagueContext {
  return {
    hexIndex: leagueHexIndex(league, HEX_RADIUS),
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
}

/** The six charts' data for a set of shots (a player's or a team's) against the league. */
export function buildDashboard(subject: ShotLite[], league: LeagueContext): DashboardData {
  const zones = statsByZone(subject);
  return {
    hex: {
      hexes: hexesVsLeague(subject, league.hexIndex),
      radius: HEX_RADIUS,
      zones: Object.fromEntries(ZONES.map((z) => [z, { player: zones[z], league: league.hexIndex.zones[z] }])) as HexShotChartData["zones"],
    },
    signature: vsLeague(fgPctByDistance(subject), league.byFoot),
    bars: { player: fgPctByDistance(subject, BAR_BIN_FT), league: league.byBin, binFt: BAR_BIN_FT },
    sides: { player: statsBySide(subject, BAR_BIN_FT), league: league.sides, binFt: BAR_BIN_FT },
  };
}
