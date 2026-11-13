/**
 * BB-G37's pure steps (behind 'bball-ingame-lineups'): one side's 1- to 5-man units and on/off rows with names, and the
 * on/off picker's split. Every unit and on/off number is the producer's (sdv-db game_units / game_on_off, BB-D32); the
 * picker's split is the one sum here, and it is exact: a unit's totals cover every stretch its players were all on the
 * floor, so "A on, B off" is inclusion-exclusion over the units that add players of B to A (a set no row covers never
 * shared the floor and counts zero).
 */
import type { InGameReads, OnOffRow, UnitRow } from '../resources/impactBox';

export const UNIT_SIZES = [1, 2, 3, 4, 5] as const;
/** The small-sample toggle's gate: a unit shows with it on when it has both (offensive possessions). */
export const MIN_MINUTES = 5;
export const MIN_POSS = 10;
/** The picker: at most this many players chosen (ON or OFF) at once; every on/off combination for up to COMBO_MAX of them. */
export const PICK_MAX = 5;
export const COMBO_MAX = 4;

/** Additive totals: seconds, possessions, opponent possessions, points, opponent points. */
export type Totals = [number, number, number, number, number];

export interface NamedUnit extends UnitRow { names: string[] }
export interface NamedOnOff extends OnOffRow { name: string }

export interface InGameSide {
    /** by size (1..5), most minutes first */
    units: Record<number, NamedUnit[]>;
    /** most minutes on first */
    onOff: NamedOnOff[];
    /** what the picker reads: the players (the on/off rows' order), each unit's totals by its sorted ids, the team's game */
    picker: { players: { id: string; name: string }[]; units: Record<string, Totals>; team: Totals } | null;
    /** the team's season net rating (team_season_rates), printed as the units' reference line; null with no producer row */
    seasonNet: { net_rtg: number; games: number | null } | null;
}

const ids = (u: UnitRow) => [u.player_1, u.player_2, u.player_3, u.player_4, u.player_5].filter((p) => p != null).map(String);
/** the picker's own key: ids sorted as strings, whatever order the producer joined them in */
export const unitKey = (players: string[]) => [...players].sort().join('-');

/** One side's rows; `name` maps a player id (the impact tables' id space) to its display name. */
export function inGameSide(reads: InGameReads, teamId: number | undefined, name: (id: string) => string): InGameSide {
    const mine = reads.units.filter((u) => Number(u.team_id) === teamId);
    const units: Record<number, NamedUnit[]> = {};
    for (const n of UNIT_SIZES) {
        units[n] = mine.filter((u) => Number(u.n_players) === n)
            .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0) || a.lineup_id.localeCompare(b.lineup_id))
            .map((u) => ({ ...u, names: ids(u).map(name) }));
    }
    const onOff = reads.onOff.filter((r) => Number(r.team_id) === teamId)
        .sort((a, b) => (b.minutes_on ?? 0) - (a.minutes_on ?? 0) || String(a.player_id).localeCompare(String(b.player_id)))
        .map((r) => ({ ...r, name: name(String(r.player_id)) }));
    // any player's on + off is his team's game
    const t = onOff[0];
    const picker = t && mine.length ? {
        players: onOff.map((r) => ({ id: String(r.player_id), name: r.name })),
        units: Object.fromEntries(mine.map((u) => [unitKey(ids(u)), [u.seconds, u.poss, u.opp_poss, u.pts, u.opp_pts] as Totals])),
        team: [((t.minutes_on ?? 0) + (t.minutes_off ?? 0)) * 60, t.poss_on + t.poss_off, t.opp_poss_on + t.opp_poss_off, t.pts_on + t.pts_off, t.opp_pts_on + t.opp_pts_off] as Totals,
    } : null;
    const r = (reads.season ?? []).find((x) => Number(x.team_id) === teamId);
    const seasonNet = r?.net_rtg != null ? { net_rtg: Number(r.net_rtg), games: r.games == null ? null : Number(r.games) } : null;
    return { units, onOff, picker, seasonNet };
}

export interface Split { minutes: number; poss: number; opp_poss: number; pts: number; opp_pts: number; plus_minus: number; off_rtg: number | null; def_rtg: number | null; net_rtg: number | null }

/**
 * The team's game with every player of `on` on the floor and every player of `off` off it:
 * sum over C of `off` of (-1)^|C| T(on + C), T of the empty set the team's game and of a set with no unit row zero.
 * At most PICK_MAX players in all (so every set looked up is a unit size).
 */
export function pickSplit(picker: NonNullable<InGameSide['picker']>, on: string[], off: string[]): Split {
    if (on.length + off.length > PICK_MAX) throw new Error(`at most ${PICK_MAX} players`);
    const sum: Totals = [0, 0, 0, 0, 0];
    for (let mask = 0; mask < 1 << off.length; mask++) {
        const set = [...on, ...off.filter((_, i) => mask & (1 << i))];
        const t = set.length ? picker.units[unitKey(set)] : picker.team;
        if (!t) continue;
        const sign = popcount(mask) % 2 ? -1 : 1;
        for (let i = 0; i < 5; i++) sum[i] += sign * t[i];
    }
    const [seconds, poss, opp_poss, pts, opp_pts] = sum.map((v, i) => (i === 0 ? Math.max(0, Math.round(v * 10) / 10) : Math.round(v)));
    const off_rtg = poss > 0 ? (100 * pts) / poss : null;
    const def_rtg = opp_poss > 0 ? (100 * opp_pts) / opp_poss : null;
    return { minutes: seconds / 60, poss, opp_poss, pts, opp_pts, plus_minus: pts - opp_pts, off_rtg, def_rtg, net_rtg: off_rtg != null && def_rtg != null ? off_rtg - def_rtg : null };
}

const popcount = (m: number) => { let c = 0; for (; m; m &= m - 1) c++; return c; };

/** Every on/off assignment of `players` (at most COMBO_MAX), all-on first, with its split. */
export function allCombos(picker: NonNullable<InGameSide['picker']>, players: string[]): { on: string[]; off: string[]; split: Split }[] {
    if (players.length > COMBO_MAX) return [];
    const out = [];
    for (let mask = 0; mask < 1 << players.length; mask++) {
        const off = players.filter((_, i) => mask & (1 << i));
        const on = players.filter((_, i) => !(mask & (1 << i)));
        out.push({ on, off, split: pickSplit(picker, on, off) });
    }
    return out;
}

/** The small-sample toggle's test: offensive possessions only, the Impact box's 10-possession rating dash. */
export const bigSample = (u: Pick<UnitRow, 'minutes' | 'poss'>) => (u.minutes ?? 0) >= MIN_MINUTES && (u.poss ?? 0) >= MIN_POSS;
