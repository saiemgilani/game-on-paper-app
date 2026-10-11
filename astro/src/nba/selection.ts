import { versusOpponents, type OpponentLine, type PlayerGame } from "./data/aggregate";
import type { ShotLite } from "./data/shots";

/** The player page's game filters: preset selections, a date window, and the shots they keep. */

export const GAME_PRESETS = ["all", "none", "home", "away", "wins", "losses"] as const;
export type GamePreset = (typeof GAME_PRESETS)[number];

export const PRESET_LABELS: Record<GamePreset, string> = {
  all: "All",
  none: "None",
  home: "Home",
  away: "Away",
  wins: "Wins",
  losses: "Losses",
};

/** Game ids a preset selects. Home and Away leave out neutral-site games; the page says how many there are. */
export function presetGames(games: Pick<PlayerGame, "game_id" | "venue" | "win">[], preset: GamePreset): string[] {
  const keep: Record<GamePreset, (g: Pick<PlayerGame, "venue" | "win">) => boolean> = {
    all: () => true,
    none: () => false,
    home: (g) => g.venue === "home",
    away: (g) => g.venue === "away",
    wins: (g) => g.win === true,
    losses: (g) => g.win === false,
  };
  return games.filter(keep[preset]).map((g) => g.game_id);
}

/** An inclusive [first, last] "YYYY-MM-DD" window, or null for the whole season. */
export type DateWindow = [string, string] | null;

/** A real calendar date written as YYYY-MM-DD (so not 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * A date typed into the From (end 0) or To (end 1) field, applied to the window: the keyboard route
 * to the brush. Only a complete date inside [first, last] counts; anything else (a partial year
 * such as 0002-12-01 while Chromium's field is mid-entry, an empty field, a date outside the
 * season) returns `window` unchanged, never cleared or swapped. A From after To pulls To along
 * (and a To before From pulls From). A window covering the whole season is no window.
 */
export function withTypedDate(window: DateWindow, end: 0 | 1, value: string, first: string, last: string): DateWindow {
  if (!isIsoDate(value) || value < first || value > last) return window;
  const [from, to] = window ?? [first, last];
  const next: [string, string] = end === 0 ? [value, to < value ? value : to] : [from > value ? value : from, value];
  if (next[0] === first && next[1] === last) return null;
  return window && next[0] === window[0] && next[1] === window[1] ? window : next;
}

export function inWindow(date: string, window: DateWindow): boolean {
  return window === null || (date >= window[0] && date <= window[1]);
}

/** Games that are selected and inside the window, in their given (date) order. */
export function visibleGames<G extends Pick<PlayerGame, "game_id" | "date">>(games: G[], selected: ReadonlySet<string>, window: DateWindow): G[] {
  return games.filter((g) => selected.has(g.game_id) && inWindow(g.date, window));
}

export function shotsForGames(shots: ShotLite[], gameIds: ReadonlySet<string>): ShotLite[] {
  return shots.filter((s) => gameIds.has(s.game_id));
}

/**
 * What every chart below the game filters is built from: the visible games (null when the
 * per-game views are unavailable), their shots, and the versus-opponent rows, all following the
 * same selection and date window.
 */
export function selectedView(
  data: { games: PlayerGame[] | null; shots: ShotLite[]; league: { fgPct: number | null } },
  selected: ReadonlySet<string>,
  window: DateWindow,
): { view: PlayerGame[] | null; shots: ShotLite[]; versus: { rows: OpponentLine[]; leagueFgPct: number | null } | null } {
  if (!data.games) return { view: null, shots: data.shots, versus: null };
  const view = visibleGames(data.games, selected, window);
  return {
    view,
    shots: shotsForGames(data.shots, new Set(view.map((g) => g.game_id))),
    versus: { rows: versusOpponents(view), leagueFgPct: data.league.fgPct },
  };
}
