/**
 * BB-G50, behind 'bball-game-logs': the advanced game logs' pure steps. Each cell is shaded against the season (its
 * rank among the season's games of that number), and a consistency line gives the game-to-game spread (standard
 * deviation) of a few numbers over the games shown. Nothing is re-modelled: every value is the producer's.
 */
import type { PlayerGame } from '../nba/data/aggregate';
import type { FlowRow, PlayerLogReads } from '../resources/bballGameLogs';
import type { ScheduleRow } from './teamSeason';
import { generateColorRampValue } from './misc';

/** 1: higher is better; -1: lower is better; 0: not shaded (minutes, usage, pace: more is not better). */
export type Dir = 1 | -1 | 0;

/** Two games are not a distribution: under this many values a column is not shaded. */
export const MIN_SHADED = 3;

/** Each value's shade against the season's values: rank among them (ties share the better rank), best at the green end. */
export function seasonShades(values: (number | null)[], dir: Dir): (string | null)[] {
    const vals = values.filter((v): v is number => v !== null);
    if (dir === 0 || vals.length < MIN_SHADED) return values.map(() => null);
    return values.map((v) => (v === null ? null : generateColorRampValue(1 + vals.filter((o) => dir * o > dir * v).length, vals.length, true)));
}

/** The sample standard deviation of the non-null values; null under two. */
export function spread(values: (number | null)[]): number | null {
    const v = values.filter((x): x is number => x !== null);
    if (v.length < 2) return null;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
}

export interface LogRow<K extends string> { gameId: string; values: Record<K, number | null> }

/** The shade of every cell, against all of the season's rows (`rows`), for the columns with a direction. */
export function shadeTable<K extends string>(rows: LogRow<K>[], dirs: Record<K, Dir>): Map<string, Record<K, string | null>> {
    const out = new Map(rows.map((r) => [r.gameId, {} as Record<K, string | null>]));
    for (const k of Object.keys(dirs) as K[]) {
        const shades = seasonShades(rows.map((r) => r.values[k]), dirs[k]);
        rows.forEach((r, i) => { out.get(r.gameId)![k] = shades[i]; });
    }
    return out;
}

// ---- player ------------------------------------------------------------------------------------------------------

export const PLAYER_KEYS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'ts_pct', 'usg_pct', 'poss', 'plus_minus', 'off_rtg', 'def_rtg', 'poe', 'epv'] as const;
export type PlayerKey = (typeof PLAYER_KEYS)[number];
export const PLAYER_DIRS: Record<PlayerKey, Dir> = {
    min: 0, pts: 1, reb: 1, ast: 1, stl: 1, blk: 1, tov: -1, ts_pct: 1, usg_pct: 0, poss: 0, plus_minus: 1, off_rtg: 1, def_rtg: -1, poe: 1, epv: 1,
};

export interface PlayerLogRow extends LogRow<PlayerKey> {
    game: PlayerGame;
    /** the game page's id; null when a pro game has no crosswalk row */
    espnGameId: string | null;
    /** "made/attempted" for FG, 3P, FT; null without a box row */
    fg: string | null; fg3: string | null; ft: string | null;
}

const ma = (m: number | null | undefined, a: number | null | undefined) => (m == null || a == null ? null : `${m}/${a}`);

/**
 * One row per game of his per-game shot rows (the page's Games panel and game-set population), date order.
 * ponytail: a game he played without a field-goal attempt has no shot row and so no log row; the box read could add it once it carries the game's date and opponent.
 */
export function playerLogRows(games: PlayerGame[], reads: PlayerLogReads, college: boolean): PlayerLogRow[] {
    return games.map((game) => {
        const id = game.game_id;
        const b = reads.box.get(id) ?? null, r = reads.rates.get(id), i = reads.impact.get(id);
        return {
            gameId: id, game,
            espnGameId: college ? id : reads.espnGame.get(id) ?? null,
            fg: ma(b?.fgm, b?.fga), fg3: ma(b?.fg3m, b?.fg3a), ft: ma(b?.ftm, b?.fta),
            values: {
                min: b?.min ?? null, pts: b?.pts ?? null, reb: b?.reb ?? null, ast: b?.ast ?? null, stl: b?.stl ?? null, blk: b?.blk ?? null, tov: b?.tov ?? null,
                ts_pct: r?.ts_pct ?? null, usg_pct: r?.usg_pct ?? null,
                poss: i?.poss ?? null, plus_minus: i?.plus_minus ?? null, off_rtg: i?.off_rtg ?? null, def_rtg: i?.def_rtg ?? null,
                poe: reads.poe.get(id) ?? null, epv: reads.epv.get(id) ?? null,
            },
        };
    });
}

// ---- team --------------------------------------------------------------------------------------------------------

export const TEAM_KEYS = ['pts', 'off_rtg', 'def_rtg', 'net_rtg', 'pace', 'efg_pct', 'tov_pct', 'orb_pct', 'ft_rate', 'lead_pct', 'lead_changes', 'largest_lead', 'max_run'] as const;
export type TeamKey = (typeof TEAM_KEYS)[number];
export const TEAM_DIRS: Record<TeamKey, Dir> = {
    pts: 1, off_rtg: 1, def_rtg: -1, net_rtg: 1, pace: 0, efg_pct: 1, tov_pct: -1, orb_pct: 1, ft_rate: 1, lead_pct: 1, lead_changes: 0, largest_lead: 1, max_run: 1,
};

export interface TeamLogRow extends LogRow<TeamKey> { game: ScheduleRow & { game_id: string; win: boolean | null } }

/** One row per final game with its rates row (the season block's schedule), date order, with its game_flow numbers. */
export function teamLogRows(schedule: ScheduleRow[], flow: Map<string, FlowRow>): TeamLogRow[] {
    return schedule.filter((g) => g.completed && g.rates && g.teamScore !== null && g.oppScore !== null).map((g) => {
        const r = g.rates!, f = flow.get(g.gameId);
        const net = r.off_rtg !== null && r.def_rtg !== null ? r.off_rtg - r.def_rtg : null;
        return {
            gameId: g.gameId,
            game: { ...g, game_id: g.gameId, win: g.teamScore! > g.oppScore! ? true : g.teamScore! < g.oppScore! ? false : null },
            values: {
                pts: g.teamScore, off_rtg: r.off_rtg, def_rtg: r.def_rtg, net_rtg: net, pace: r.pace, efg_pct: r.efg_pct, tov_pct: r.tov_pct, orb_pct: r.orb_pct, ft_rate: r.ft_rate,
                lead_pct: f?.lead_pct ?? null, lead_changes: f?.lead_changes ?? null, largest_lead: f?.largest_lead ?? null, max_run: f?.max_run ?? null,
            },
        };
    });
}

/** The columns with at least one value: a league or season without a table shows no empty column. */
export const filledKeys = <K extends string>(rows: LogRow<K>[], keys: readonly K[]): K[] => keys.filter((k) => rows.some((r) => r.values[k] !== null));
