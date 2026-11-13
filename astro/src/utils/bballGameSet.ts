/**
 * BB-G14, behind 'bball-game-set': the game-set filter on the basketball team and player pages, football's
 * `?games=` (utils/gameSet.ts) for the four basketball leagues. One URL per set, so a filtered view is a shareable link.
 *
 * Team page: All, Home and Away are the producer's own split rows (sdv-db team_season_rates, the season block's
 * read), so "All games" is exactly the season block's numbers. Wins, Losses and the last-N sets have no producer row:
 * they sum each game's counts from the block's schedule and game_team_rates reads (points from the final score,
 * possessions and minutes from the game page's box score) and divide once. A per-game rate is never averaged.
 * Player page: every set sums his per-game shot counts (the page's shot_player_games read) and divides once.
 */
import { lineOf, type FieldGoals, type ShootingLine } from '../nba/data/aggregate';
import { presetGames } from '../nba/selection';
import type { TeamSeasonRateRow } from '../resources/teamSeason';
import type { ScheduleRow } from './teamSeason';

export const BB_GAME_SETS = [
    { key: 'all', label: 'All games' },
    { key: 'home', label: 'Home' },
    { key: 'away', label: 'Away' },
    { key: 'wins', label: 'Wins' },
    { key: 'losses', label: 'Losses' },
    { key: 'last5', label: 'Last 5 games', last: 5 },
    { key: 'last10', label: 'Last 10 games', last: 10 },
    { key: 'last20', label: 'Last 20 games', last: 20 },
] as const satisfies readonly { key: string; label: string; last?: number }[];
export type BbGameSet = (typeof BB_GAME_SETS)[number]['key'];

/** The `?games=` value as a set; anything else is `all`. */
export function bbGameSetOf(param: string | null | undefined): BbGameSet {
    return BB_GAME_SETS.find((s) => s.key === param)?.key ?? 'all';
}

export const bbGameSetLabel = (set: BbGameSet): string => BB_GAME_SETS.find((s) => s.key === set)!.label;

type Game = { game_id: string; date: string; venue: 'home' | 'away' | 'neutral'; win: boolean | null };

/** The games of a set. Home and Away leave out neutral sites (the player page's presets); last N is by date. */
export function pickGames<G extends Game>(games: G[], set: BbGameSet): G[] {
    const n = BB_GAME_SETS.find((s) => s.key === set);
    if (n && 'last' in n) return games.toSorted((a, b) => a.date.localeCompare(b.date) || a.game_id.localeCompare(b.game_id)).slice(-n.last);
    const keep = new Set(presetGames(games, set as 'all' | 'home' | 'away' | 'wins' | 'losses'));
    return games.filter((g) => keep.has(g.game_id));
}

/** A set's link: the page's own URL with `games` set (dropped for `all`, the canonical page), anchored on `anchor`. */
export function gameSetHref(url: URL, set: BbGameSet, anchor: string): string {
    const q = new URLSearchParams(url.searchParams);
    if (set === 'all') q.delete('games'); else q.set('games', set);
    const s = q.toString();
    return `${url.pathname}${s ? `?${s}` : ''}#${anchor}`;
}

/**
 * The select's navigation: an option is the canonical URL, kept on the uncacheable /preview surface when the page is on
 * it (BracketologyRoute's pattern): the public URL is where the flag is off, and may answer a cached anonymous copy.
 */
export const GAME_SET_NAV = "window.location.href = (location.pathname.startsWith('/preview/') ? '/preview' : '') + this.value";

// ---- team page ---------------------------------------------------------------------------------------------------

export interface TeamSetLine {
    games: number;
    poss: number;
    off_rtg: number | null;
    def_rtg: number | null;
    net_rtg: number | null;
    pace: number | null;
    /** the producer's percentiles, for the shading: present on All / Home / Away only */
    off_rtg_pct?: number | null;
    def_rtg_pct?: number | null;
    net_rtg_pct?: number | null;
    /** the producer's pace rank and percentile, printed beside the unshaded pace: present on All / Home / Away only */
    pace_rank?: number | null;
    pace_pct?: number | null;
}

export interface TeamGameSetView {
    set: BbGameSet;
    /** the sets with at least one game, `all` first: the select's options */
    sets: BbGameSet[];
    line: TeamSetLine;
    /** true: the producer's split row; false: summed from the game rows */
    producer: boolean;
}

/** A team's final, rated games: the summed sets' population (a game without box-score possessions has no rates). */
const ratedGames = (schedule: ScheduleRow[]) => schedule
    .filter((g) => g.completed && g.teamScore !== null && g.oppScore !== null && g.rates?.possessions != null && g.rates.possessions > 0 && g.rates.game_minutes != null)
    .map((g) => ({ ...g, game_id: g.gameId, win: g.teamScore! > g.oppScore! ? true : g.teamScore! < g.oppScore! ? false : null }));

/**
 * The summed line: points and possessions added over the games, then divided once. game_team_rates' ratings share
 * one possession count per game (the two teams' box-score estimates averaged), so DRtg is over the same total.
 * Pace is possessions per regulation length: `regulationMinutes` × Σ possessions / Σ game minutes.
 */
export function summedTeamLine(games: ScheduleRow[], regulationMinutes: number): TeamSetLine {
    let poss = 0, pts = 0, opp = 0, minutes = 0;
    for (const g of games) {
        poss += g.rates!.possessions!;
        minutes += g.rates!.game_minutes!;
        pts += g.teamScore!;
        opp += g.oppScore!;
    }
    const per100 = (x: number) => (poss > 0 ? (100 * x) / poss : null);
    return { games: games.length, poss, off_rtg: per100(pts), def_rtg: per100(opp), net_rtg: per100(pts - opp), pace: minutes > 0 ? (regulationMinutes * poss) / minutes : null };
}

const producerLine = (r: TeamSeasonRateRow): TeamSetLine => ({
    games: r.games, poss: r.poss, off_rtg: r.off_rtg, def_rtg: r.def_rtg, net_rtg: r.net_rtg, pace: r.pace,
    off_rtg_pct: r.off_rtg_pct, def_rtg_pct: r.def_rtg_pct, net_rtg_pct: r.net_rtg_pct, pace_rank: r.pace_rank, pace_pct: r.pace_pct,
});

/** The team's view for `requested`. A set it has no game in falls back to `all`, so a shared link never renders empty. */
export function teamGameSet(rates: TeamSeasonRateRow[], schedule: ScheduleRow[], requested: BbGameSet, regulationMinutes: number): TeamGameSetView | null {
    const split = new Map(rates.map((r) => [r.split as string, r]));
    if (!split.has('all')) return null;
    const rated = ratedGames(schedule);
    const has = (s: BbGameSet) => (s === 'all' || s === 'home' || s === 'away' ? (split.get(s)?.games ?? 0) > 0 : pickGames(rated, s).length > 0);
    const sets = BB_GAME_SETS.map((s) => s.key).filter(has);
    const set = sets.includes(requested) ? requested : 'all';
    const row = split.get(set);
    if (row) return { set, sets, line: producerLine(row), producer: true };
    return { set, sets, line: summedTeamLine(pickGames(rated, set), regulationMinutes), producer: false };
}

// ---- player page -------------------------------------------------------------------------------------------------

export interface PlayerGameSetView {
    set: BbGameSet;
    sets: BbGameSet[];
    games: number;
    line: ShootingLine;
}

/** His line over the set's games: makes, attempts and threes summed, the percentages divided once (lineOf). */
export function playerGameSet(games: (Game & FieldGoals)[], requested: BbGameSet): PlayerGameSetView | null {
    if (games.length === 0) return null;
    const sets = BB_GAME_SETS.map((s) => s.key).filter((s) => pickGames(games, s).length > 0);
    const set = sets.includes(requested) ? requested : 'all';
    const picked = pickGames(games, set);
    const sum = (k: keyof FieldGoals) => picked.reduce((t, g) => t + g[k], 0);
    return { set, sets, games: picked.length, line: lineOf({ attempts: sum('attempts'), makes: sum('makes'), fg3a: sum('fg3a'), fg3m: sum('fg3m') }) };
}
