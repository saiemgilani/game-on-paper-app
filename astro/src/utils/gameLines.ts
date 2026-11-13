/**
 * BB-G43's Lines and markets panel ('bball-lines'), the pure half: the game's market row (sdv-db `game_lines`, BB-D33), its
 * cover and total result against the line shown, the upset tag, and the live "at this pace" projection from the clock.
 * Islands never import this; the panel renders on the server.
 */
import type { BasketballLeague } from './league';
import { clockSeconds, periodStart } from './gameFlow';

/** One `{lg}.game_lines` row: `spread_home_*` is negative when the home side is favoured; the WPs have the vig removed. */
export interface GameLine {
    game_id: number | string
    season: number
    n_books: number | null
    spread_home_open: number | null; spread_home_close: number | null
    total_open: number | null; total_close: number | null
    ml_home_open: number | null; ml_away_open: number | null; ml_home_close: number | null; ml_away_close: number | null
    market_home_wp_open: number | null; market_away_wp_open: number | null; market_home_wp_close: number | null; market_away_wp_close: number | null
    /** finished games only */
    home_margin: number | null; ats_result: 'home' | 'away' | 'push' | null; total_result: 'over' | 'under' | 'push' | null
}

/** The first season each league's odds files cover (BB-D33); an earlier game has no row, so it is never read. */
export const LINES_FROM: Record<BasketballLeague, number> = { nba: 2020, wnba: 2022, mbb: 2021, wbb: 2025 };

/** The quote a result or a pace is measured against: the close, else the open (an unplayed or unmapped close is null). */
export const latest = (open: number | null, close: number | null): number | null => close ?? open;

export const lineSpread = (l: GameLine) => latest(l.spread_home_open, l.spread_home_close);
export const lineTotal = (l: GameLine) => latest(l.total_open, l.total_close);
export const marketHomeWp = (l: GameLine) => latest(l.market_home_wp_open, l.market_home_wp_close);

/** Who covered `spreadHome` (negative: home favoured) at this score. */
export function cover(spreadHome: number, home: number, away: number): 'home' | 'away' | 'push' {
    const m = home - away + spreadHome;
    return m > 0 ? 'home' : m < 0 ? 'away' : 'push';
}

export function overUnder(total: number, home: number, away: number): 'over' | 'under' | 'push' {
    const t = home + away;
    return t > total ? 'over' : t < total ? 'under' : 'push';
}

/** "NY -5.5" (the favourite, as the books list it), "PK". */
export function spreadText(spreadHome: number, home: string, away: string): string {
    return spreadHome === 0 ? 'PK' : spreadHome < 0 ? `${home} ${spreadHome}` : `${away} -${spreadHome}`;
}

export const moneylineText = (ml: number) => (ml > 0 ? `+${ml}` : String(ml));

/** Q38: the Upset cut, the league hub's (#458's `UPSET_WP` in basketball/hub.ts): the winner's no-vig pregame market WP under 35%. */
export const UPSET_WP = 0.35;

/** The winner's pregame market WP when it was under UPSET_WP; null for a favourite's or a near coin flip's win, a tie or no market. */
export function upset(l: GameLine, home: number, away: number): { side: 'home' | 'away'; wp: number } | null {
    const hw = marketHomeWp(l);
    if (hw == null || home === away) return null;
    const side = home > away ? 'home' : 'away';
    const wp = side === 'home' ? hw : 1 - hw;
    return wp < UPSET_WP ? { side, wp } : null;
}

export interface Pace { home: number; away: number; total: number; elapsed: number }

/**
 * "At this pace": each side's points so far over the elapsed game clock, times regulation. Regulation only: in overtime
 * (or with no clock to read) there is no pace to give, so null; also null before any time has run.
 */
export function pace(period: number | null, displayClock: string | null, regulation: number, periodSeconds: number, home: number, away: number): Pace | null {
    if (period == null || period < 1 || period > regulation || displayClock == null) return null;
    const left = clockSeconds(displayClock);
    if (left == null) return null;
    const elapsed = periodStart(period, regulation, periodSeconds) + Math.max(0, periodSeconds - left);
    if (!(elapsed > 0)) return null;
    const k = (regulation * periodSeconds) / elapsed;
    return { home: home * k, away: away * k, total: (home + away) * k, elapsed };
}
