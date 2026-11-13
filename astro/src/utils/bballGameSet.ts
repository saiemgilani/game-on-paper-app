/**
 * BB-G14, behind 'bball-game-set': the game-set filter on the basketball team and player pages, football's
 * `?games=` (utils/gameSet.ts) for the four basketball leagues. One URL per set, so a filtered view is a shareable link.
 *
 * Team page: All, Home, Away, Close games and Clutch are the producer's own split rows (sdv-db team_season_rates, the
 * season block's read), so "All games" is exactly the season block's numbers. Wins, Losses, the last-N sets and (college)
 * Conference games have no producer split row: they add up the producer's per-team-game possessions rows
 * (team_game_possessions, the play-by-play count the split rows are built from, so a season's games give its All row)
 * over the set's games, then divide once. A per-game rate is never averaged.
 * Player page: every set sums his per-game shot counts (the page's shot_player_games read) and divides once; Close games,
 * Clutch and Conference games are team-page sets (no per-player-game producer rows), so his page offers the others.
 */
import { lineOf, type FieldGoals, type ShootingLine } from '../nba/data/aggregate';
import { presetGames } from '../nba/selection';
import type { GameSetCountReads, TeamSeasonRateRow } from '../resources/teamSeason';
import type { ScheduleRow } from './teamSeason';

export const BB_GAME_SETS = [
    { key: 'all', label: 'All games' },
    { key: 'home', label: 'Home' },
    { key: 'away', label: 'Away' },
    { key: 'close', label: 'Close games', team: true },
    { key: 'clutch', label: 'Clutch', team: true },
    { key: 'conference', label: 'Conference games', team: true },
    { key: 'wins', label: 'Wins' },
    { key: 'losses', label: 'Losses' },
    { key: 'last5', label: 'Last 5 games', last: 5 },
    { key: 'last10', label: 'Last 10 games', last: 10 },
    { key: 'last20', label: 'Last 20 games', last: 20 },
] as const satisfies readonly { key: string; label: string; last?: number; team?: true }[];
export type BbGameSet = (typeof BB_GAME_SETS)[number]['key'];

/** The `?games=` value as a set; anything else is `all`. */
export function bbGameSetOf(param: string | null | undefined): BbGameSet {
    return BB_GAME_SETS.find((s) => s.key === param)?.key ?? 'all';
}

export const bbGameSetLabel = (set: BbGameSet): string => BB_GAME_SETS.find((s) => s.key === set)!.label;

/** The team page's producer split rows: All, Home, Away, Close games, Clutch. */
const PRODUCER_SETS: ReadonlySet<BbGameSet> = new Set(['all', 'home', 'away', 'close', 'clutch']);
/** True for a team-page set summed from the per-game possessions rows (the sets that need retrieveGameSetCounts). */
export const isSummedSet = (set: BbGameSet): boolean => !PRODUCER_SETS.has(set);

type Game = { game_id: string; date: string; venue: 'home' | 'away' | 'neutral'; win: boolean | null };
/** The sets a game list can pick (no Close games / Clutch / Conference: those are the team page's). */
type PickSet = Exclude<BbGameSet, 'close' | 'clutch' | 'conference'>;

/** The games of a set. Home and Away leave out neutral sites (the player page's presets); last N is by date. */
export function pickGames<G extends Game>(games: G[], set: PickSet): G[] {
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
    /** the producer's percentiles, for the shading: present on the producer's split rows only */
    off_rtg_pct?: number | null;
    def_rtg_pct?: number | null;
    net_rtg_pct?: number | null;
    /** the producer's pace rank and percentile, printed beside the unshaded pace: present on the split rows only */
    pace_rank?: number | null;
    pace_pct?: number | null;
}

export interface TeamGameSetView {
    set: BbGameSet;
    /** the sets with at least one game, `all` first: the select's options */
    sets: BbGameSet[];
    /** null: a summed set whose possessions reads failed (the block says so) */
    line: TeamSetLine | null;
    /** true: the producer's split row; false: summed from the per-game possessions rows */
    producer: boolean;
}

/** One team-game's play-by-play totals: the producer's team_game_possessions row. */
export interface TeamGameCounts { poss: number; opp_poss: number; pts: number; opp_pts: number; seconds: number }

/** Per ESPN game, the team's possessions row. A game the map does not name is left out. */
export function teamGameCounts(reads: GameSetCountReads): Map<string, TeamGameCounts> {
    const out = new Map<string, TeamGameCounts>();
    for (const r of reads.games) {
        const espn = reads.espnOf.get(String(r.game_id));
        if (espn) out.set(espn, { poss: r.poss ?? 0, opp_poss: r.opp_poss ?? 0, pts: r.pts ?? 0, opp_pts: r.opp_pts ?? 0, seconds: r.seconds ?? 0 });
    }
    return out;
}

/**
 * The summed line: points and possessions added over the games, then divided once (ORtg over the team's possessions,
 * DRtg over the opponent's). Pace is both sides' possessions, averaged, per regulation length.
 */
export function summedTeamLine(games: TeamGameCounts[], regulationMinutes: number): TeamSetLine {
    let poss = 0, opp_poss = 0, pts = 0, opp = 0, seconds = 0;
    for (const g of games) {
        poss += g.poss;
        opp_poss += g.opp_poss;
        pts += g.pts;
        opp += g.opp_pts;
        seconds += g.seconds;
    }
    const off = poss > 0 ? (100 * pts) / poss : null;
    const def = opp_poss > 0 ? (100 * opp) / opp_poss : null;
    return { games: games.length, poss, off_rtg: off, def_rtg: def, net_rtg: off !== null && def !== null ? off - def : null, pace: seconds > 0 ? (regulationMinutes * 60 * (poss + opp_poss)) / 2 / seconds : null };
}

const producerLine = (r: TeamSeasonRateRow): TeamSetLine => ({
    games: r.games, poss: r.poss, off_rtg: r.off_rtg, def_rtg: r.def_rtg, net_rtg: r.net_rtg, pace: r.pace,
    off_rtg_pct: r.off_rtg_pct, def_rtg_pct: r.def_rtg_pct, net_rtg_pct: r.net_rtg_pct, pace_rank: r.pace_rank, pace_pct: r.pace_pct,
});

/** A team's final games with both scores: the summed sets' population before the possessions rows are read. */
const finals = (schedule: ScheduleRow[]) => schedule
    .filter((g) => g.completed && g.teamScore !== null && g.oppScore !== null)
    .map((g) => ({ ...g, game_id: g.gameId, win: g.teamScore! > g.oppScore! ? true : g.teamScore! < g.oppScore! ? false : null }));

/**
 * The sets the select offers: a producer split with games, a summed set with at least one final (Conference games for
 * college only), `all` first. The route reads the possessions rows only once the chosen set is a summed one.
 */
export function teamSets(rates: TeamSeasonRateRow[], schedule: ScheduleRow[], college: boolean): BbGameSet[] {
    const split = new Map(rates.map((r) => [r.split as string, r]));
    if (!split.has('all')) return [];
    const done = finals(schedule);
    return BB_GAME_SETS.map((s) => s.key).filter((s) => {
        if (PRODUCER_SETS.has(s)) return (split.get(s)?.games ?? 0) > 0;
        if (s === 'conference') return college && done.length > 0;
        return pickGames(done, s as PickSet).length > 0;
    });
}

/**
 * The team's view for `requested`. A set it has no game in falls back to `all`, so a shared link never renders empty.
 * `counts` is the summed sets' reads: undefined when not read (a producer set), null when they failed.
 */
export function teamGameSet(rates: TeamSeasonRateRow[], schedule: ScheduleRow[], requested: BbGameSet, regulationMinutes: number, college: boolean, counts?: GameSetCountReads | null): TeamGameSetView | null {
    const sets = teamSets(rates, schedule, college);
    if (sets.length === 0) return null;
    const all = { set: 'all' as const, sets, line: producerLine(rates.find((r) => r.split === 'all')!), producer: true };
    const set = sets.includes(requested) ? requested : 'all';
    const row = PRODUCER_SETS.has(set) ? rates.find((r) => r.split === set) : undefined;
    if (row) return { set, sets, line: producerLine(row), producer: true };
    if (counts === null) return { set, sets, line: null, producer: false };
    if (counts === undefined) return all;
    const per = teamGameCounts(counts);
    const rated = finals(schedule).filter((g) => per.has(g.gameId));
    const picked = set === 'conference' ? rated.filter((g) => counts.conference?.has(g.gameId)) : pickGames(rated, set as PickSet);
    if (picked.length === 0) return all;
    return { set, sets, line: summedTeamLine(picked.map((g) => per.get(g.gameId)!), regulationMinutes), producer: false };
}

// ---- player page -------------------------------------------------------------------------------------------------

/** The player page's sets: the team page's less Close games, Clutch and Conference games. */
const PLAYER_SETS = BB_GAME_SETS.filter((s) => !('team' in s)).map((s) => s.key) as PickSet[];

export interface PlayerGameSetView {
    set: PickSet;
    sets: PickSet[];
    games: number;
    line: ShootingLine;
    /** the set's game ids: the explorer island starts from them */
    gameIds: string[];
}

/** His line over the set's games: makes, attempts and threes summed, the percentages divided once (lineOf). */
export function playerGameSet(games: (Game & FieldGoals)[], requested: BbGameSet): PlayerGameSetView | null {
    if (games.length === 0) return null;
    const sets = PLAYER_SETS.filter((s) => pickGames(games, s).length > 0);
    const set = (sets as BbGameSet[]).includes(requested) ? (requested as PickSet) : 'all';
    const picked = pickGames(games, set);
    const sum = (k: keyof FieldGoals) => picked.reduce((t, g) => t + g[k], 0);
    return { set, sets, games: picked.length, line: lineOf({ attempts: sum('attempts'), makes: sum('makes'), fg3a: sum('fg3a'), fg3m: sum('fg3m') }), gameIds: picked.map((g) => g.game_id) };
}
