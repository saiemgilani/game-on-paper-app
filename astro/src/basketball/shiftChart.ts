// BB-G36, behind 'bball-shift-chart': the game page's shift chart. One row per player (each team's starters, then its bench
// by minutes), a bar for every stint on the floor coloured by the stint's +/-, period dividers, and the stint's detail on
// hover. Every number is the producer's (sdv-db game_stints, BB-D32); this places and labels them. The `?shift_on=` param
// highlights a set of players and draws the stretches they shared the floor: BB-G37's lineup tables link here with
// shiftHref(). Pure: the server renders the chart.
import type { NbaGame } from '../resources/nbaGame';
import type { MappedStint } from '../resources/gameStints';
import { orderPlayers } from '../nba/data/game';
import { periodShort } from './periods';
import { cleanAbbreviation } from '../utils/misc';

/** The highlight param: comma-separated ESPN athlete ids. */
export const SHIFT_PARAM = 'shift_on';
/** At most a five-man unit is highlighted. */
export const SHIFT_MAX = 5;
/** Every league's overtime period is five minutes. */
const OT_SECONDS = 300;

/** The link that opens the shift chart with these players (ESPN athlete ids) highlighted; BB-G37 appends it to the game URL. */
export function shiftHref(ids: readonly (string | number)[]): string {
    return `?${SHIFT_PARAM}=${ids.slice(0, SHIFT_MAX).join(',')}#shifts`;
}

/** The highlighted ids from the URL: numeric ids only, deduplicated, at most SHIFT_MAX. */
export function parseShiftOn(q: URLSearchParams): string[] {
    const ids = (q.get(SHIFT_PARAM) ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
    return [...new Set(ids)].slice(0, SHIFT_MAX);
}

/** A bar: `from` / `to` in percent of the game's length. */
export interface ShiftBar { from: number; to: number; pm: number | null; label: string }
export interface ShiftRow { id: string; name: string; starter: boolean; minutes: string; bars: ShiftBar[]; on: boolean }
export interface ShiftSide {
    key: 'away' | 'home'; abbr: string; name: string; rows: ShiftRow[]
    /** with two or more of this side highlighted: the stretches they were all on, and how long */
    together: { bars: { from: number; to: number }[]; minutes: string } | null
    /** the rows cover less than five on the floor all game: a player the id crosswalk does not map yet has no row */
    gap: boolean
}
export interface ShiftView { periods: { at: number; label: string }[]; sides: ShiftSide[]; highlighted: boolean }

const minus = '−';
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `${minus}${-v}` : '0');
/** 754 -> '12:34'; seconds are whole in the producer's clock, but a tenth is kept if it ever is not. */
export function mmss(secs: number): string {
    const s = Math.max(0, secs);
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${(Number.isInteger(r) ? String(r) : r.toFixed(1)).padStart(2, '0')}`;
}

/**
 * The chart for one final. `periodMinutes` is the game's regulation period length (12 NBA, 10 WNBA and women's college
 * quarters, 20 college halves); `on` the highlighted ESPN ids. A box player with no mapped stint has no row.
 */
export function shiftView(game: NbaGame, rows: MappedStint[], periodMinutes: number, on: readonly string[] = []): ShiftView {
    const n = Math.max(game.periods, ...rows.map((r) => Number(r.period)));
    const len = (p: number) => (p <= game.regulation ? periodMinutes * 60 : OT_SECONDS);
    const start: number[] = [0];
    for (let p = 1; p <= n; p++) start.push(start[p - 1] + len(p));
    const total = start[n];
    const pct = (secs: number) => Math.min(100, Math.max(0, (secs / total) * 100));
    const at = (period: number, clock: number) => start[period - 1] + len(period) - clock;
    const label = (p: number) => periodShort(p, game.regulation, game.periodKind);

    const byPlayer = new Map<string, MappedStint[]>();
    for (const r of rows) byPlayer.set(r.espn, [...(byPlayer.get(r.espn) ?? []), r]);
    const onSet = new Set(on);

    const sides = (['away', 'home'] as const).map((key): ShiftSide => {
        const side = game[key];
        const { starters, bench } = orderPlayers(side.players);
        const out: ShiftRow[] = [];
        let covered = 0;
        for (const p of [...starters, ...bench]) {
            const id = String(p.athlete_id);
            const st = (byPlayer.get(id) ?? []).filter((r) => r.side === key);
            if (st.length === 0) continue;
            st.sort((a, b) => at(a.period, a.clock_in) - at(b.period, b.clock_in));
            const secs = st.reduce((s, r) => s + (r.seconds ?? r.clock_in - r.clock_out), 0);
            covered += secs;
            out.push({
                id, name: p.name, starter: p.starter, minutes: mmss(secs), on: onSet.has(id),
                bars: st.map((r) => {
                    const span = r.seconds ?? r.clock_in - r.clock_out;
                    const score = r.pts != null && r.opp_pts != null ? ` · ${r.pts}–${r.opp_pts}` : '';
                    const poss = r.poss != null && r.opp_poss != null ? ` · ${r.poss} poss, ${r.opp_poss} opp poss` : '';
                    const pm = r.plus_minus ?? (r.pts != null && r.opp_pts != null ? r.pts - r.opp_pts : null);
                    return {
                        from: pct(at(r.period, r.clock_in)), to: pct(at(r.period, r.clock_out)), pm,
                        label: `${p.name}: ${label(r.period)} ${mmss(r.clock_in)}–${mmss(r.clock_out)} (${mmss(span)})${pm == null ? '' : ` · ${signed(pm)}`}${score}${poss}`,
                    };
                }),
            });
        }
        // the stretches every highlighted player of this side was on: the intersection of their stints, in game seconds
        const mine = out.filter((r) => r.on).map((r) => byPlayer.get(r.id)!.filter((s) => s.side === key).map((s) => [at(s.period, s.clock_in), at(s.period, s.clock_out)] as [number, number]));
        let together: ShiftSide['together'] = null;
        if (mine.length >= 2) {
            const shared = mine.slice(1).reduce(intersect, mine[0]);
            together = { bars: shared.map(([a, b]) => ({ from: pct(a), to: pct(b) })), minutes: mmss(shared.reduce((s, [a, b]) => s + b - a, 0)) };
        }
        return { key, abbr: cleanAbbreviation(side.team), name: side.team.displayName, rows: out, together, gap: covered < 5 * total - 1 };
    });
    return {
        periods: Array.from({ length: n }, (_, i) => ({ at: pct(start[i]), label: label(i + 1) })),
        sides, highlighted: sides.some((s) => s.rows.some((r) => r.on)),
    };
}

/** Two sorted lists of [from, to) intervals: where both cover. */
export function intersect(a: [number, number][], b: [number, number][]): [number, number][] {
    const x = [...a].sort((p, q) => p[0] - q[0]), y = [...b].sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    for (let i = 0, j = 0; i < x.length && j < y.length;) {
        const lo = Math.max(x[i][0], y[j][0]), hi = Math.min(x[i][1], y[j][1]);
        if (hi > lo) out.push([lo, hi]);
        if (x[i][1] < y[j][1]) i++; else j++;
    }
    return out;
}

/** A stint's fill: blue when the team won the stint, orange when it lost it, grey level; deeper with the margin (10 caps it). */
export function pmFill(pm: number | null): string {
    if (pm == null || pm === 0) return 'rgba(140,140,140,0.55)';
    const a = (0.35 + 0.65 * Math.min(Math.abs(pm), 10) / 10).toFixed(2);
    return pm > 0 ? `rgba(33,102,172,${a})` : `rgba(230,97,1,${a})`;
}
