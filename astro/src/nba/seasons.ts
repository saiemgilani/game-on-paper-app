// The pure part of blazing-the-nets lib/data/seasons.ts: no next-season probe (the Data API
// has a season when the nightly ingest lands it; LAST_KNOWN_SEASON is the annual bump).
import { FIRST_SEASON, LAST_KNOWN_SEASON } from "./seasonRange";

export { FIRST_SEASON, LAST_KNOWN_SEASON } from "./seasonRange";

/** Seasons the site lists, ascending; the last one is the current season. */
export function siteSeasons(): number[] {
  return Array.from({ length: LAST_KNOWN_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);
}

/** 2026 -> "2025-26" (assets are keyed by the season's ending year). */
export function seasonLabel(endYear: number): string {
  return `${endYear - 1}-${String(endYear % 100).padStart(2, "0")}`;
}

/** A `?season=` value: a listed season, else the current (last) one. */
export function parseSeason(param: string | null | undefined, seasons: number[]): number {
  const year = param != null && /^\d{4}$/.test(param) ? Number(param) : NaN;
  return seasons.includes(year) ? year : seasons[seasons.length - 1];
}
