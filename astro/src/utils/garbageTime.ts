/**
 * The game page's garbage-time toggle (BB-G2, behind 'bball-garbage-time'): `?garbage=out` re-shows the four factors,
 * the team box and the Impact box from the game's possession log with its garbage-time possessions left out.
 *
 * The flag is the producer's (BB-D7's `is_garbage_time` on `{nba,wnba}_stats.possessions`, bigballR's on
 * `{mbb,wbb}.ncaa_possessions`); nothing here decides what garbage time is, and nothing is modelled or ranked. Each
 * possession is mapped the way sdv-py maps it for its situational splits (BB-D21, `_common/situational_splits.py`, through
 * `nba_possession_rate_rows` / `ncaa_possession_rate_rows`), so a split here is that module's `not_garbage_time` row for
 * the one game: every possession seen from both sides, credited to the ten players on the floor as it starts, counts
 * summed and divided once.
 */
import { TOP_UNITS, type ImpactBoxReads, type LineupRow } from '../resources/impactBox';
import type { GarbageReads } from '../resources/garbageTime';
import { PRO_LEAGUES, type BasketballLeague } from './league';

/** One possession of the log, mapped. */
export interface SplitPossession {
    period: number;
    offense: number | null;
    defense: number | null;
    /** seconds left in the period as it starts (the previous possession's end) */
    startClock: number;
    seconds: number;
    points: number;
    /** null when the log has no flag for it: the possession is in neither split, as in sdv-py */
    garbage: boolean | null;
    /** the players on the floor as it starts, unique, nulls dropped */
    off: (number | string)[];
    def: (number | string)[];
    /** the pros' event counts for the offense; college logs carry points only */
    counts: Counts | null;
}

export interface Counts { fga: number; fgm: number; fg3a: number; fg3m: number; fta: number; ftm: number; oreb: number; dreb: number; tov: number }

const OT_SECONDS = 300;
const n = (v: unknown) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const id = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
/** A Data API flag: a boolean, 'True'/'true', or college's 0/1; null when the log has none. */
const flag = (v: unknown): boolean | null => (v == null || v === '' ? null : v === true || v === 1 || v === '1' || v === 'True' || v === 'true');
const ascending = (a: number | string, b: number | string) => (a < b ? -1 : a > b ? 1 : 0);
/** The five slots' players, unique, nulls dropped, sorted (sdv-py: `list.drop_nulls().list.unique().list.sort()`). */
const slots = (r: Record<string, any>, key: (i: number) => string) => [...new Set([1, 2, 3, 4, 5].map((i) => r[key(i)]).filter((v) => v != null && v !== ''))].sort(ascending);

/**
 * True when every possession carries the producer's flag (a release published before BB-D7 carries none): no flag, no
 * toggle. A partly flagged log gets none either, since its All column would leave the unclassified possessions out (the
 * four leagues' sources have no null flag; sdv-py's split puts one in neither side).
 */
export const hasGarbageFlag = (rows: readonly Record<string, any>[]) => rows.length > 0 && rows.every((r) => r.is_garbage_time != null);

/**
 * `{nba,wnba}_stats.possessions` rows (sdv-py `nba_possession_rate_rows`): a possession starts at the previous one's end
 * in the period (the period's length for the first), its points are the made-shot counts. `periodSeconds` is a regulation
 * period's length (a half for a two-halves game).
 */
export function proPossessions(rows: readonly Record<string, any>[], regulation: number, periodSeconds: number): SplitPossession[] {
    const sorted = [...rows].sort((a, b) => n(a.period) - n(b.period) || n(a.possession_number) - n(b.possession_number));
    return sorted.map((r, i) => {
        const period = n(r.period);
        const prev = sorted[i - 1];
        const startClock = prev && n(prev.period) === period ? n(prev.end_seconds_remaining) : period <= regulation ? periodSeconds : OT_SECONDS;
        const c: Counts = { fga: n(r.fg2a) + n(r.fg3a), fgm: n(r.fg2m) + n(r.fg3m), fg3a: n(r.fg3a), fg3m: n(r.fg3m), fta: n(r.fta), ftm: n(r.ftm), oreb: n(r.oreb), dreb: n(r.dreb), tov: n(r.tov) };
        return {
            period, offense: id(r.offense_team_id), defense: id(r.defense_team_id), startClock, seconds: startClock - n(r.end_seconds_remaining),
            points: 2 * n(r.fg2m) + 3 * n(r.fg3m) + n(r.ftm), garbage: flag(r.is_garbage_time),
            off: slots(r, (i) => `off_player_${i}`), def: slots(r, (i) => `def_player_${i}`), counts: c,
        };
    });
}

/**
 * `{mbb,wbb}.ncaa_possessions` rows (sdv-py `ncaa_possession_rate_rows` / `ncaa_situation_rows`): ESPN team ids (null for
 * a non-D1 side), a possession lasts its `last_event_time`, and the period's clock runs back from its end.
 */
export function ncaaPossessions(rows: readonly Record<string, any>[]): SplitPossession[] {
    const sorted = [...rows].sort((a, b) => n(a.period) - n(b.period) || n(a.poss_num) - n(b.poss_num));
    const left = new Map<number, number>(); // seconds of the period's possessions not yet started
    for (const r of sorted) left.set(n(r.period), (left.get(n(r.period)) ?? 0) + n(r.last_event_time));
    return sorted.map((r) => {
        const period = n(r.period);
        const startClock = left.get(period)!;
        left.set(period, startClock - n(r.last_event_time));
        const home = r.poss_team === r.home;
        const [own, other] = home ? ['home', 'away'] : ['away', 'home'];
        return {
            period, offense: id(r.poss_team_espn_team_id), defense: id(r[`${other}_espn_team_id`]), startClock, seconds: n(r.last_event_time),
            points: n(r.pts), garbage: flag(r.is_garbage_time), off: slots(r, (i) => `${own}_${i}_player_id`), def: slots(r, (i) => `${other}_${i}_player_id`), counts: null,
        };
    });
}

/** sdv-py `_rates`: minutes, +/-, the ratings per 100 (null with no possessions). */
export interface Totals { seconds: number; poss: number; opp_poss: number; pts: number; opp_pts: number }
export interface Rated extends Totals { minutes: number; plus_minus: number; off_rtg: number | null; def_rtg: number | null; net_rtg: number | null }
const per100 = (num: number, den: number) => (den > 0 ? (100 * num) / den : null);
export const rated = (t: Totals): Rated => {
    const off_rtg = per100(t.pts, t.poss), def_rtg = per100(t.opp_pts, t.opp_poss);
    return { ...t, minutes: t.seconds / 60, plus_minus: t.pts - t.opp_pts, off_rtg, def_rtg, net_rtg: off_rtg == null || def_rtg == null ? null : off_rtg - def_rtg };
};

export interface TeamSplit extends Rated { team_id: number; counts: Counts | null; /** the opponent's defensive rebounds on this team's possessions */ opp_dreb: number | null; /** this team's own defensive rebounds */ dreb: number | null }
export interface PlayerSplit extends Rated { team_id: number; player_id: number | string }
export interface LineupSplit extends Rated { team_id: number; lineup_id: string; players: (number | string)[] }
export interface Split { possessions: number; teams: TeamSplit[]; players: PlayerSplit[]; lineups: LineupSplit[] }

const zero = (): Totals => ({ seconds: 0, poss: 0, opp_poss: 0, pts: 0, opp_pts: 0 });
const zeroCounts = (): Counts => ({ fga: 0, fgm: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, oreb: 0, dreb: 0, tov: 0 });

/**
 * The totals of the possessions `keep` accepts, per team, player and five-man unit: sdv-py `situational_team` /
 * `situational_player` / `situational_lineup` for one game and one split. A side with no team id (a non-D1 opponent) has
 * no row; a unit needs five known players.
 */
export function splitTotals(possessions: readonly SplitPossession[], keep: (p: SplitPossession) => boolean): Split {
    const teams = new Map<number, Totals & { counts: Counts | null; opp_dreb: number; dreb: number }>();
    const players = new Map<string, PlayerSplit & Totals>();
    const lineups = new Map<string, LineupSplit & Totals>();
    let kept = 0;
    const add = (t: Totals, p: SplitPossession, off: boolean) => {
        t.seconds += p.seconds;
        if (off) { t.poss += 1; t.pts += p.points; } else { t.opp_poss += 1; t.opp_pts += p.points; }
    };
    for (const p of possessions) {
        if (!keep(p)) continue;
        kept += 1;
        for (const [team, ids, off] of [[p.offense, p.off, true], [p.defense, p.def, false]] as const) {
            if (team == null) continue;
            const t = teams.get(team) ?? { ...zero(), counts: p.counts ? zeroCounts() : null, opp_dreb: 0, dreb: 0 };
            teams.set(team, t);
            add(t, p, off);
            if (p.counts && t.counts) {
                if (off) { for (const k of ['fga', 'fgm', 'fg3a', 'fg3m', 'fta', 'ftm', 'oreb', 'tov'] as const) t.counts[k] += p.counts[k]; t.opp_dreb += p.counts.dreb; }
                else t.dreb += p.counts.dreb; // dreb is the defense's
            }
            for (const pid of ids) {
                const k = `${team}|${pid}`;
                const row = players.get(k) ?? ({ team_id: team, player_id: pid, ...zero() } as PlayerSplit & Totals);
                players.set(k, row);
                add(row, p, off);
            }
            if (ids.length === 5) {
                const lineup_id = ids.join('-');
                const k = `${team}|${lineup_id}`;
                const row = lineups.get(k) ?? ({ team_id: team, lineup_id, players: [...ids], ...zero() } as LineupSplit & Totals);
                lineups.set(k, row);
                add(row, p, off);
            }
        }
    }
    return {
        possessions: kept,
        teams: [...teams].map(([team_id, t]) => ({ ...rated(t), team_id, counts: t.counts, opp_dreb: t.counts ? t.opp_dreb : null, dreb: t.counts ? t.dreb : null })),
        players: [...players.values()].map((r) => ({ ...r, ...rated(r) })),
        lineups: [...lineups.values()].map((r) => ({ ...r, ...rated(r) })),
    };
}

export const isOut = (p: SplitPossession) => p.garbage === false;

/** Where garbage time starts: the first flagged possession's period and clock; null when the game had none. */
export function garbageStart(possessions: readonly SplitPossession[]): { period: number; clock: number } | null {
    const first = possessions.find((p) => p.garbage === true);
    return first ? { period: first.period, clock: first.startClock } : null;
}

/** "5:07" from seconds left in the period. */
export const clockText = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** The four factors and the team box from one team's split: the game page's formulas (sdv-py `team_game_rates`) on the log's counts. */
export function splitRates(t: TeamSplit | undefined, regulationMinutes: number) {
    if (!t) return null;
    const c = t.counts;
    const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
    return {
        efg_pct: c ? ratio(c.fgm + 0.5 * c.fg3m, c.fga) : null,
        tov_pct: c ? ratio(c.tov, c.fga + 0.44 * c.fta + c.tov) : null,
        orb_pct: c ? ratio(c.oreb, c.oreb + t.opp_dreb!) : null,
        ft_rate: c ? ratio(c.fta, c.fga) : null,
        possessions: t.poss,
        off_rtg: t.off_rtg,
        def_rtg: t.def_rtg,
        // every possession is seen from both sides, so the team's seconds are the split's game clock
        pace: t.seconds > 0 ? (regulationMinutes * (t.poss + t.opp_poss)) / 2 / (t.seconds / 60) : null,
    };
}
export type SplitRates = NonNullable<ReturnType<typeof splitRates>>;

/** The box rows the log can recompute (the pros'), as counts per team. */
export interface SplitBox { pts: number; fgm: number; fga: number; fg3m: number; fg3a: number; ftm: number; fta: number; oreb: number; dreb: number; tov: number }
const splitBox = (t: TeamSplit | undefined): SplitBox | null => (t?.counts ? { pts: t.pts, fgm: t.counts.fgm, fga: t.counts.fga, fg3m: t.counts.fg3m, fg3a: t.counts.fg3a, ftm: t.counts.ftm, fta: t.counts.fta, oreb: t.counts.oreb, dreb: t.dreb!, tov: t.counts.tov } : null);

type Side = 'home' | 'away';
type Pair<T> = Record<Side, { all: T; out: T }>;
export interface GarbageView {
    out: boolean;
    /** the log could not be read for a `?garbage=out` render: the page says so and shows the whole game */
    unavailable?: true;
    /** possessions flagged garbage time, of the log */
    excluded: number;
    total: number;
    start: { period: number; clock: number } | null;
    /** regulation's length in minutes: pace's unit */
    regulationMinutes: number;
    /** `out` only: the four factors and (pros) the box rows, for all the log's possessions and with garbage time out */
    rates?: Pair<SplitRates | null>;
    box?: Pair<SplitBox | null> | null;
    /** `out` only: the Impact box's rows with garbage time out (BB-G1's names, the log's totals) */
    impact?: ImpactBoxReads;
}

/**
 * What the page shows, from the route's reads. Undefined (no toggle, the page is the flag-off page) when there is nothing
 * to toggle: no log, a log without the flag, no garbage possession, or no Impact box to put the toggle beside.
 */
export function garbageView(reads: GarbageReads | null, impact: ImpactBoxReads | null | undefined, out: boolean, league: BasketballLeague, regulation: number, periodMinutes: number): GarbageView | undefined {
    if (reads === null) return out ? { out, unavailable: true, excluded: 0, total: 0, start: null, regulationMinutes: regulation * periodMinutes } : undefined;
    if (!reads.teams || !impact?.players.length || !hasGarbageFlag(reads.rows)) return undefined;
    const log = (PRO_LEAGUES.includes(league) ? proPossessions(reads.rows, regulation, periodMinutes * 60) : ncaaPossessions(reads.rows));
    const excluded = log.filter((p) => p.garbage).length;
    if (excluded === 0) return undefined;
    const view: GarbageView = { out, excluded, total: log.length, start: garbageStart(log), regulationMinutes: regulation * periodMinutes };
    if (!out) return view;
    const all = splitTotals(log, () => true), kept = splitTotals(log, isOut);
    const team = (s: Split, side: Side) => s.teams.find((t) => t.team_id === reads.teams![side]);
    const pair = <T>(f: (s: Split, side: Side) => T): Pair<T> => ({ home: { all: f(all, 'home'), out: f(kept, 'home') }, away: { all: f(all, 'away'), out: f(kept, 'away') } });
    view.rates = pair((s, side) => splitRates(team(s, side), view.regulationMinutes));
    view.box = PRO_LEAGUES.includes(league) ? pair((s, side) => splitBox(team(s, side))) : null;
    const units = (side: Side): LineupRow[] => kept.lineups.filter((u) => u.team_id === reads.teams![side])
        .sort((a, b) => b.seconds - a.seconds || ascending(a.lineup_id, b.lineup_id)).slice(0, TOP_UNITS)
        .map((u) => ({ ...u, player_1: u.players[0], player_2: u.players[1], player_3: u.players[2], player_4: u.players[3], player_5: u.players[4] }));
    view.impact = { ...impact, teams: reads.teams, players: kept.players, lineups: { home: units('home'), away: units('away') } };
    return view;
}
