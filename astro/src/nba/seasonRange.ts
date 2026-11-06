/** The season range as plain constants: no runtime imports, so the proxy can use it without the data layer. */

import type { LeaderBars } from "./data/leaders";

/**
 * First season the site lists: 1997-98. Every shots file from 1998 has the columns, dtypes and legacy
 * frame the site reads, and its attempts equal the published FGA for every shooter. 1996-97 (1997)
 * is left out: whole games have no shot locations (shots parked at the hoop), some shots have no team
 * (team_id 0), shot_distance disagrees with x/y for 10% of shots, and the three-point line was 22 ft
 * all round, which court.ts does not draw. 1998-2010 park most layups, dunks and tips at the hoop
 * centre (0, 0); the README lists that caveat. Measured 2026-10-01.
 */
export const FIRST_SEASON = 1998;

/** `nba_stats_shots` holds shots_1997..shots_2026 (checked 2026-09-30). Bump when a season lands. */
export const FIRST_DATA_SEASON = 1997;
export const LAST_KNOWN_SEASON = 2026;

/** A season a URL may name: listed now, or the next one once it is published. */
export function isAddressableSeason(year: number): boolean {
  return Number.isInteger(year) && year >= FIRST_SEASON && year <= LAST_KNOWN_SEASON + 1;
}

/** 2012-13 is the Nets' first Brooklyn season; through 2011-12 they are New Jersey (NJN in the release). */
export const FIRST_BROOKLYN_SEASON = 2013;

/** The Nets' tricode in a season, as the release files spell it. */
export function netsTricode(season: number): "BKN" | "NJN" {
  return season < FIRST_BROOKLYN_SEASON ? "NJN" : "BKN";
}

/** The WNBA's first season (1997) and the last one the shots and schedule releases hold (checked 2026-10-12). Bump when a season lands. */
export const WNBA_FIRST_SEASON = 1997;
export const WNBA_LAST_KNOWN_SEASON = 2026;

/**
 * WNBA regular-season games per team: [first season, games], ascending. Measured 2026-10-12 as the distinct regular-season
 * (102…) game ids per team in wehoop-wnba-stats-data's shots and player game logs, 1997-2026 (every team the same count).
 */
const WNBA_SEASON_GAMES: readonly (readonly [number, number])[] = [
  [1997, 28], [1998, 30], [1999, 32], [2003, 34], [2020, 22], [2021, 32], [2022, 36], [2023, 40], [2025, 44],
];
/** A season's length; a season after the table takes the latest length until the table is bumped with LAST_KNOWN_SEASON. */
export function wnbaSeasonGames(season: number): number {
  return [...WNBA_SEASON_GAMES].reverse().find(([from]) => season >= from)?.[1] ?? WNBA_SEASON_GAMES[0][1];
}

/**
 * D31: the rolling leaders' per-game bars, the NBA's 5 FGA / 3 3PA scaled by WNBA ÷ NBA team FGA per game that season.
 * Measured 2026-10-12 on the regular-season shots (wehoop-wnba-stats-data, hoopR-nba-stats-data; Task 5 Step 0): the ratio
 * is 0.707-0.827 in every season 1997-2026 (2026: 68.63 / 89.09), so the rounded bars are 4 and 2 in every one.
 */
export function wnbaLeaderBars(_season: number): LeaderBars {
  return { fga: 4, fg3a: 2 }; // ponytail: one value for every measured season; a season that rounds differently gets a table
}
