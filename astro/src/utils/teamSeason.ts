/**
 * The team season block's pure steps (BB-G5): the split rows in the producer's order and the schedule joined to each
 * game's rates. Nothing here aggregates: the record, every season rate, rank and percentile is the producer's (rule B6).
 */
import { SPLITS, type GameRateRow, type ScheduleGameRow, type Split, type TeamSeasonRateRow } from '../resources/teamSeason';
import { numberOrNull } from './misc';

export const SPLIT_LABEL: Record<Split, string> = { all: 'All games', home: 'Home', away: 'Away', close: 'Close games', clutch: 'Clutch' };

/** The rows in SPLITS order; a split the producer has no row for is left out. */
export function splitRows(rates: TeamSeasonRateRow[]): TeamSeasonRateRow[] {
    const by = new Map(rates.map((r) => [r.split, r]));
    return SPLITS.flatMap((s) => (by.has(s) ? [by.get(s)!] : []));
}

export interface ScheduleRow {
    gameId: string;
    date: string;
    /** 'home', 'away' or 'neutral' (ESPN's neutral_site: listed home, played elsewhere) */
    venue: 'home' | 'away' | 'neutral';
    oppId: number;
    oppAbbr: string;
    oppName: string;
    completed: boolean;
    /** null until the game is final */
    teamScore: number | null;
    oppScore: number | null;
    /** null when the game has no rates row (not played, or not yet built) */
    rates: GameRateRow | null;
}

const isTrue = (v: unknown) => v === true || v === 'true' || v === 'TRUE';

/** The team's games by date, each with its own rates row. A game listed twice (both reads) is kept once. */
export function scheduleRows(games: ScheduleGameRow[], gameRates: GameRateRow[], espnId: number): ScheduleRow[] {
    const ratesOf = new Map(gameRates.map((r) => [String(r.game_id), r]));
    const seen = new Set<string>();
    const out: ScheduleRow[] = [];
    for (const g of games) {
        const id = String(g.id);
        if (seen.has(id)) continue;
        seen.add(id);
        const home = Number(g.home_id) === espnId;
        const completed = isTrue(g.status_type_completed);
        const [mine, theirs] = home ? [g.home_score, g.away_score] : [g.away_score, g.home_score];
        out.push({
            gameId: id,
            date: String(g.date),
            venue: isTrue(g.neutral_site) ? 'neutral' : home ? 'home' : 'away',
            oppId: Number(home ? g.away_id : g.home_id),
            oppAbbr: String((home ? g.away_abbreviation : g.home_abbreviation) ?? ''),
            oppName: String((home ? g.away_display_name : g.home_display_name) ?? ''),
            completed,
            teamScore: completed ? numberOrNull(mine) : null,
            oppScore: completed ? numberOrNull(theirs) : null,
            rates: ratesOf.get(id) ?? null,
        });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId));
}
