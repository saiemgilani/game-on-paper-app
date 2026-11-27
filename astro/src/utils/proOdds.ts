/** The Pro odds board (gop-pro odds.py -> `pro/odds/odds.json`, flag 'pro-odds'): types and formatting. */

export interface OddsBook {
    book: string; updated: string | null; away_price: number; home_price: number; hold: number
    away_fair: number | null; home_fair: number | null; note: string | null
}
export interface OddsGame {
    id: string; start: string; away: string; home: string
    consensus: { away: number; home: number } | null
    /** edge: consensus fair minus the best price's implied chance; positive = the price pays more than fair. */
    best: Record<'away' | 'home', { book: string; price: number; edge: number | null }>
    best_hold: number; crossed: boolean; books: OddsBook[]
}
export interface OddsBoard {
    snapshot: string; rendered: string; headlines: string[]; limits: string[]
    leagues: { key: string; name: string; games: OddsGame[] }[]
}

/** American odds -> the book's implied probability, margin included. */
export function implied(price: number): number {
    return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

/** `+145` / `-175` / `EVEN` (+100). */
export function fmtAmerican(price: number): string {
    if (price === 100 || price === -100) return 'EVEN';
    return price > 0 ? `+${price}` : String(price);
}

/** 0.6177 -> `61.8%`; null -> an em dash. `signed` prefixes a + on positives (edges). */
export function fmtPct(p: number | null, signed = false): string {
    if (p === null || Number.isNaN(p)) return '—';
    const s = `${(p * 100).toFixed(1)}%`;
    return signed && p > 0 ? `+${s}` : s;
}

/** A game's start in US Eastern time, `Thu, Nov 27, 1:00 PM ET`. */
export function fmtStart(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`;
}

/** The league to show: the requested key when the board has it, else the first league with games. */
export function pickLeague(board: OddsBoard, requested: string | null): OddsBoard['leagues'][number] | null {
    return board.leagues.find((l) => l.key === requested) ?? board.leagues.find((l) => l.games.length > 0) ?? board.leagues[0] ?? null;
}
