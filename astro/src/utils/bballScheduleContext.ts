/**
 * BB-G53's pure steps ('bball-schedule-context'): each schedule game's rest, back-to-back, third-in-four-nights and
 * road-trip position, its opponent's strength, the team's closing line and ATS result, and the rotation (minutes by player
 * by game). Rest follows sdv-py's nba_rest_travel (BB-D23): days off since the team's previous game (0 on a back-to-back),
 * capped at REST_CAP, a season opener capped; a third in four nights is a game whose second-previous game was at most three
 * days earlier. Days are the tip's day where the league keeps its scoreboard. A road trip is a run of games away from home
 * (a neutral site counts as away). The ATS result and the line are the producer's (game_lines); this only turns home/away
 * into the team's side.
 */
import { DateTime } from 'luxon';
import type { LineRow, OppStrength, RotationBoxRow, ScheduleContextReads } from '../resources/bballScheduleContext';
import type { ScheduleRow } from './teamSeason';
import { numberOrNull } from './misc';

/** sdv-py nba_rest_travel.REST_CAP: two or more days off is "rested". */
export const REST_CAP = 2;

export type Ats = 'W' | 'L' | 'P';
export interface GameContext {
    /** days off before the game, 0..REST_CAP */
    rest: number;
    b2b: boolean;
    threeInFour: boolean;
    /** the game's place in a road trip; null at home */
    trip: { game: number; of: number } | null;
    /** null: no strength row for the opponent (or the read failed) */
    opp: OppStrength | null;
    /** the team's closing spread (negative: favoured); null with no line */
    spread: number | null;
    /** null until the game is final, or with no line */
    ats: Ats | null;
}

const isTrue = (v: unknown) => v === true || v === 'true' || v === 'TRUE';
/** the tip's calendar day in `zone`, as a day number (so a daylight-saving switch is no fraction of a day) */
const localDay = (iso: string, zone: string) => {
    const t = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
    return Date.UTC(t.year, t.month - 1, t.day) / 86_400_000;
};

/** The team's side of the producer's ATS result: `listedHome` is ESPN's home team, which a neutral site keeps. */
export function teamAts(line: LineRow | undefined, listedHome: boolean): { spread: number | null; ats: Ats | null } {
    const close = numberOrNull(line?.spread_home_close);
    const spread = close === null ? null : listedHome ? close : -close;
    const r = line?.ats_result;
    const ats = r === 'push' ? 'P' : r === 'home' || r === 'away' ? ((r === 'home') === listedHome ? 'W' : 'L') : null;
    return { spread: spread === 0 ? 0 : spread, ats };
}

/** Every schedule game's context by game id. `rows` in date order (scheduleRows); `listedHome` by game id. */
export function scheduleContext(rows: ScheduleRow[], listedHome: Map<string, boolean>, reads: ScheduleContextReads, zone: string): Map<string, GameContext> {
    const out = new Map<string, GameContext>();
    const days = rows.map((g) => localDay(g.date, zone));
    // road trips: each maximal run of non-home games, numbered within the run
    const tripOf: ({ game: number; of: number } | null)[] = rows.map(() => null);
    for (let i = 0; i < rows.length; ) {
        if (rows[i].venue === 'home') { i++; continue; }
        let j = i;
        while (j < rows.length && rows[j].venue !== 'home') j++;
        for (let k = i; k < j; k++) tripOf[k] = { game: k - i + 1, of: j - i };
        i = j;
    }
    rows.forEach((g, i) => {
        const gap = i > 0 ? days[i] - days[i - 1] - 1 : REST_CAP;
        const rest = Math.min(Math.max(gap, 0), REST_CAP);
        const threeInFour = i > 1 && days[i] - days[i - 2] <= 3;
        out.set(g.gameId, {
            rest,
            b2b: rest === 0,
            threeInFour,
            trip: tripOf[i],
            opp: reads.strength?.get(String(g.oppId)) ?? null,
            ...teamAts(reads.lines?.get(g.gameId), listedHome.get(g.gameId) ?? g.venue === 'home'),
        });
    });
    return out;
}

/** W-L-P against the closing line over the final games with one. */
export function atsRecord(ctx: Iterable<GameContext>): { w: number; l: number; p: number } {
    const rec = { w: 0, l: 0, p: 0 };
    for (const c of ctx) if (c.ats) rec[c.ats === 'W' ? 'w' : c.ats === 'L' ? 'l' : 'p']++;
    return rec;
}

/** W-L on the second night of a back-to-back, over the final games. */
export function b2bRecord(rows: ScheduleRow[], ctx: Map<string, GameContext>): { games: number; w: number; l: number } {
    const rec = { games: 0, w: 0, l: 0 };
    for (const g of rows) {
        if (!ctx.get(g.gameId)?.b2b) continue;
        rec.games++;
        if (g.teamScore !== null && g.oppScore !== null) rec[g.teamScore > g.oppScore ? 'w' : 'l']++;
    }
    return rec;
}

export interface RotationPlayer {
    id: string;
    name: string;
    gp: number;
    gs: number;
    /** minutes per game played */
    mpg: number;
    /** one per rotation game: minutes, or null when he did not play */
    minutes: (number | null)[];
    started: boolean[];
}
export interface Rotation {
    /** the final games with box rows, in date order: the strip's columns */
    games: ScheduleRow[];
    /** every player with a minute, most minutes first (the depth order) */
    players: RotationPlayer[];
    /** the most-used starting five and its starts; null with no five-man start */
    five: { names: string[]; starts: number } | null;
    /** distinct starting fives */
    fives: number;
}

export function rotation(rows: ScheduleRow[], box: RotationBoxRow[]): Rotation {
    const byGame = new Map<string, RotationBoxRow[]>();
    for (const r of box) {
        const k = String(r.game_id);
        byGame.set(k, [...(byGame.get(k) ?? []), r]);
    }
    const games = rows.filter((g) => g.completed && byGame.has(g.gameId));
    const players = new Map<string, RotationPlayer>();
    const fiveCount = new Map<string, number>();
    games.forEach((g, i) => {
        const starters: string[] = [];
        for (const r of byGame.get(g.gameId)!) {
            const id = String(r.athlete_id);
            const min = isTrue(r.did_not_play) ? null : numberOrNull(r.minutes);
            const played = min !== null && min > 0;
            const started = played && isTrue(r.starter);
            if (!played) continue;
            let p = players.get(id);
            if (!p) {
                p = { id, name: String(r.athlete_short_name ?? id), gp: 0, gs: 0, mpg: 0, minutes: games.map(() => null), started: games.map(() => false) };
                players.set(id, p);
            }
            p.gp++;
            p.mpg += min;
            p.minutes[i] = min;
            if (started) { p.gs++; p.started[i] = true; starters.push(id); }
        }
        if (starters.length === 5) {
            const key = starters.sort().join(',');
            fiveCount.set(key, (fiveCount.get(key) ?? 0) + 1);
        }
    });
    const list = [...players.values()].map((p) => ({ ...p, total: p.mpg, mpg: p.mpg / p.gp }));
    list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    let five: Rotation['five'] = null;
    for (const [key, starts] of fiveCount) {
        if (!five || starts > five.starts) five = { names: key.split(','), starts };
    }
    if (five) {
        const order = new Map(list.map((p, i) => [p.id, i]));
        five.names = five.names.sort((a, b) => order.get(a)! - order.get(b)!).map((id) => players.get(id)!.name);
    }
    return { games, players: list.map(({ total: _t, ...p }) => p), five, fives: fiveCount.size };
}
