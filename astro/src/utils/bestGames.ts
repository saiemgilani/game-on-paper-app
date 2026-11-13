// The pure steps of /<league>/best-games (BB-G29): join the season's game_excitement rows to its schedule, filter by
// day range and team, order by GEI. No number is computed here: the GEI, lead changes, swing and season rank are sdv-py's.
import type { BestGameScheduleRow, GameExcitementRow } from '../resources/bestGames';

/** The board's length: a season's top games, not its whole table. */
export const BOARD_SIZE = 50;

export interface BestGameTeam { id: string; name: string; abbr: string; score: number | null }

export interface BestGame {
    gameId: string;
    /** YYYY-MM-DD */
    date: string;
    postseason: boolean;
    note: string | null;
    home: BestGameTeam;
    away: BestGameTeam;
    gei: number;
    leadChanges: number | null;
    maxSwingPts: number | null;
    rank: number | null;
    n: number | null;
}

export interface BestGamesFilter {
    /** YYYY-MM-DD, inclusive; null for open */
    from: string | null;
    to: string | null;
    /** an ESPN team id; null for every team */
    team: string | null;
}

/** Ids are bigint in one schema and integer in another: one string form at the join, never a float's "123.0". */
const idOf = (v: unknown): string | null => (v == null || v === '' ? null : String(Math.trunc(Number(v))));

const team = (r: BestGameScheduleRow, side: 'home' | 'away'): BestGameTeam => {
    const name = r[`${side}_display_name`] ?? '';
    return { id: idOf(r[`${side}_id`]) ?? '', name, abbr: r[`${side}_abbreviation`] ?? name, score: r[`${side}_score`] };
};

/** Completed, ranked games that have a schedule row (a game the schedule lacks has no day or teams to show), by GEI. */
export function joinBestGames(excitement: GameExcitementRow[], schedule: BestGameScheduleRow[]): BestGame[] {
    const byId = new Map(schedule.map((r) => [idOf(r.id), r]));
    const out: BestGame[] = [];
    for (const e of excitement) {
        if (e.completed !== true || e.gei == null) continue;
        const s = byId.get(idOf(e.game_id));
        if (!s?.game_date) continue;
        out.push({
            gameId: idOf(e.game_id)!, date: String(s.game_date).slice(0, 10), postseason: Number(s.season_type) === 3,
            note: s.notes_headline || null, home: team(s, 'home'), away: team(s, 'away'),
            gei: e.gei, leadChanges: e.lead_changes, maxSwingPts: e.max_swing_pts, rank: e.gei_rank, n: e.gei_n,
        });
    }
    // the producer's rank shares ties; the later game breaks them so the order is stable across reads
    return out.sort((a, b) => b.gei - a.gei || b.date.localeCompare(a.date) || a.gameId.localeCompare(b.gameId));
}

export const isDay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** The games in the day range (inclusive) that the team played, in board order. */
export function filterBestGames(games: BestGame[], f: BestGamesFilter): BestGame[] {
    return games.filter((g) => (!f.from || g.date >= f.from) && (!f.to || g.date <= f.to) && (!f.team || g.home.id === f.team || g.away.id === f.team));
}

/** Every team that played a ranked game, by name: the team select's options. */
export function teamOptions(games: BestGame[]): { id: string; name: string }[] {
    const m = new Map<string, string>();
    for (const g of games) for (const t of [g.home, g.away]) if (t.id && !m.has(t.id)) m.set(t.id, t.name || t.abbr);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
