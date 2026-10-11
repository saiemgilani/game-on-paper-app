import { lineOf, type FieldGoals, type PlayerGame } from "./aggregate";

/** Shotline-style rolling-window leaderboards: each player's latest N games against the league. */

export const LEADER_WINDOWS = [5, 10, 20] as const;
export type LeaderWindow = (typeof LEADER_WINDOWS)[number];

export const LEADER_METRICS = ["fgPct", "efgPct", "fg3Pct", "improved"] as const;
export type LeaderMetric = (typeof LEADER_METRICS)[number];

export const LEADER_LABELS: Record<LeaderMetric, string> = {
  fgPct: "FG%",
  efgPct: "eFG%",
  fg3Pct: "3P%",
  improved: "Most improved",
};

/** Eligible: 5 attempts per game of the window (and 3 threes per game for 3P%). */
export const minAttempts = (n: number) => 5 * n;
export const minThrees = (n: number) => 3 * n;

/** Active shooters only (R-BN-27): a window ending more than this many days before the season's latest game is dropped. */
export const ACTIVE_DAYS = 14;

/** The earliest window end that still counts as active: the season's latest game minus ACTIVE_DAYS. */
export function activeSince(players: PlayerGames[]): string | null {
  let latest = "";
  for (const p of players) {
    const d = p.games[p.games.length - 1]?.date;
    if (d && d > latest) latest = d;
  }
  if (!latest) return null;
  const t = new Date(`${latest}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ACTIVE_DAYS);
  return t.toISOString().slice(0, 10);
}

export interface PlayerGames {
  person_id: number;
  name: string;
  /** His team in his latest game. */
  team_id: number;
  team: string;
  games: PlayerGame[]; // date order
}

export interface WindowLine extends FieldGoals {
  games: number;
  from: string;
  to: string;
}

/** The player's last `n` games with a field-goal attempt (fewer if he has fewer), pooled. */
export function windowLine(games: PlayerGame[], n: number): WindowLine | null {
  const last = games.slice(-n);
  if (!last.length) return null;
  const fg = { attempts: 0, makes: 0, fg3a: 0, fg3m: 0 };
  for (const g of last) {
    fg.attempts += g.attempts;
    fg.makes += g.makes;
    fg.fg3a += g.fg3a;
    fg.fg3m += g.fg3m;
  }
  return { ...fg, games: last.length, from: last[0].date, to: last[last.length - 1].date };
}

export interface LeaderRow {
  person_id: number;
  name: string;
  /** His team in the window's last game. */
  team_id: number;
  team: string;
  rank: number;
  /** The ranked number: the window's rate, or for "improved" the window eFG% minus his season eFG%. */
  value: number;
  window: WindowLine;
  /** His season eFG% ("improved" only). */
  seasonEfg: number | null;
}

/**
 * One board: eligible players ranked on `metric` over their last `n` games with a field-goal
 * attempt (competition ranking: ties share a rank). A full window is required (n such games) so a
 * 5-game rookie is not compared with a 20-game window; with `since`, a window that ended before
 * that date (an inactive shooter) is left out.
 */
export function leaderboard(players: PlayerGames[], n: number, metric: LeaderMetric, since: string | null = null): LeaderRow[] {
  const rows: Omit<LeaderRow, "rank">[] = [];
  for (const p of players) {
    const w = windowLine(p.games, n);
    if (!w || w.games < n || w.attempts < minAttempts(n)) continue;
    if (since !== null && w.to < since) continue;
    const line = lineOf(w);
    let value: number | null;
    let seasonEfg: number | null = null;
    if (metric === "fg3Pct") value = w.fg3a >= minThrees(n) ? line.fg3Pct : null;
    else if (metric === "improved") {
      seasonEfg = lineOf(windowLine(p.games, p.games.length) ?? w).efgPct;
      value = line.efgPct !== null && seasonEfg !== null ? line.efgPct - seasonEfg : null;
    } else value = line[metric];
    if (value === null) continue;
    rows.push({ person_id: p.person_id, name: p.name, team_id: p.team_id, team: p.team, value, window: w, seasonEfg });
  }
  rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.value !== rows[i - 1].value) rank = i + 1;
    return { ...r, rank };
  });
}

export interface Board {
  /** The top rows. */
  rows: LeaderRow[];
  /** Highlighted-team players ranked below the top rows (so the Nets always show). */
  also: LeaderRow[];
  eligible: number;
}

export type Boards = Record<LeaderWindow, Record<LeaderMetric, Board>>;

/** The first `top` rows, extended to the end of a tie group that straddles the cut. */
export function topRows(ranked: LeaderRow[], top: number): LeaderRow[] {
  let end = Math.min(top, ranked.length);
  while (end > 0 && end < ranked.length && ranked[end].rank === ranked[end - 1].rank) end++;
  return ranked.slice(0, end);
}

/** Every window x metric board of active shooters, top `top` rows each (ties kept whole), plus the highlighted team's other rows. */
export function leaderBoards(players: PlayerGames[], highlightTeamId: number, top = 15): Boards {
  const since = activeSince(players);
  const out = {} as Boards;
  for (const n of LEADER_WINDOWS) {
    out[n] = {} as Record<LeaderMetric, Board>;
    for (const metric of LEADER_METRICS) {
      const all = leaderboard(players, n, metric, since);
      const rows = topRows(all, top);
      out[n][metric] = { rows, also: all.slice(rows.length).filter((r) => r.team_id === highlightTeamId), eligible: all.length };
    }
  }
  return out;
}
