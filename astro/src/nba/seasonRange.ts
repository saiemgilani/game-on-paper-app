/** The season range as plain constants: no imports, so the proxy can use it without the data layer. */

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
