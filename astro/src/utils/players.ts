/**
 * Individual player pages: the path shapes the 'player-pages' flag gates, and
 * the pure arithmetic the page does over the Data API's player-keyed reads
 * (`/v1/{league}/players/{espn id}[/seasons|/games|/splits]`, sdv-db #71).
 *
 * Two rules come from the API's own contract and are load-bearing here:
 *
 * 1. `/seasons` is a DIFFERENT producer from `/games` and `/splits` — CFB's
 *    passer rows key on ESPN's completion/incompletion player rather than
 *    `passer_player_id`, so its counts are not the pbp counts. The page's
 *    season summary tiles therefore come from the GAME LOG, which shares the
 *    `/splits` population exactly; the season line table shows the producer's
 *    own rows (with their `_rank`/`_pct`) beside them, never mixed in.
 * 2. **A CFB passer's `EPAplay` is per dropback, not per play.** The season
 *    leaderboards already label it `EPA/DB` (`SDV_PLAYER_METRIC_CATEGORIES`);
 *    the career roll-up recomputes it the same way rather than dividing by
 *    plays, which would silently publish a different number.
 */

import { SDV_PLAYER_METRIC_CATEGORIES, SDV_PLAYER_METRIC_FORMATTING_VALUES, SDV_PLAYER_PERCENT_COLUMNS } from './constants';
import { leaguePath, type League } from './league';
import { roundNumber } from './misc';

/** The season-table categories, in the order the page shows them. */
export const PLAYER_CATEGORIES = ['passing', 'rushing', 'receiving'] as const;
export type PlayerCategory = (typeof PLAYER_CATEGORIES)[number];

/** The name column each category's rows carry, as the leaderboards read it. */
export const PLAYER_NAME_FIELD: Record<PlayerCategory, string> = {
    passing: 'passer_player_name',
    rushing: 'rusher_player_name',
    receiving: 'receiver_player_name',
};

/** `/splits` rows, in the order they are shown; `all` is the population the rest partition. */
export const PLAYER_SPLITS: { key: string; label: string; title: string }[] = [
    { key: 'all', label: 'All plays', title: 'Every play from scrimmage on a numbered down carrying this player' },
    { key: 'standard_downs', label: 'Standard downs', title: '1st down, 2nd and short of 8, 3rd or 4th and short of 5' },
    { key: 'passing_downs', label: 'Passing downs', title: '2nd and 8 or more, 3rd or 4th and 5 or more' },
    { key: 'red_zone', label: 'Red zone', title: 'Snaps inside the opponent 20' },
    { key: 'first_half', label: '1st half', title: 'Plays in the first half' },
    { key: 'second_half', label: '2nd half', title: 'Plays in the second half' },
    { key: 'overtime', label: 'Overtime', title: 'Plays in overtime' },
];

/** The two splits that partition `all` by down type, and the three that partition it by period. */
export const SPLIT_PARTITIONS: string[][] = [
    ['standard_downs', 'passing_downs'],
    ['first_half', 'second_half', 'overtime'],
];

/** `/players/<id>` and `/nfl/players/<id>`, segment-exact. */
export function isPlayerPath(pathname: string): boolean {
    const p = pathname === '/nfl' || pathname.startsWith('/nfl/') ? pathname.slice(4) || '/' : pathname;
    return /^\/players(\/|$)/.test(p);
}

export function playerPath(league: League | undefined, espnId: string | number, season?: number | null): string {
    const base = leaguePath(league, `/players/${espnId}`);
    return season ? `${base}?season=${season}` : base;
}

/**
 * An NFL gsis id (`00-0031381`) as the season leaderboard tables key on, versus
 * the ESPN athlete id the pages and the API are keyed on. The NFL leaderboard
 * rows carry the former, so `/nfl/players/00-0031381` resolves the crosswalk
 * once and redirects to the canonical ESPN-id URL.
 */
export const isGsisId = (id: string): boolean => /^\d{2}-\d{7}$/.test(id);

/** An ESPN athlete id: digits only. Anything else never reaches the API. */
export const isEspnAthleteId = (id: string): boolean => /^\d{1,12}$/.test(id);

export interface PlayerGameRow {
    game_id?: string | null;
    season?: number;
    week?: number | null;
    season_type?: string | null;
    game_date?: string | null;
    team_id?: string | number | null;
    opponent_id?: string | number | null;
    opponent?: string | null;
    home_away?: string | null;
    team_score?: number | null;
    opponent_score?: number | null;
    result?: string | null;
    box?: Record<string, unknown>;
    plays?: number | null;
    epa?: number | null;
    successes?: number | null;
    [k: string]: unknown;
}

export interface PlayerTotals {
    games: number;
    plays: number;
    epa: number;
    successes: number;
    epa_per_play: number | null;
    success_rate: number | null;
}

const n = (v: unknown): number => {
    const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(x) ? x : 0;
};

/** Present-and-finite, so a null EPA column is "no data" rather than a zero. */
export function numberOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '' || v === 'NA') return null;
    const x = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(x) ? x : null;
}

/**
 * The season summary tiles: the additive game-log columns, summed, with the two
 * rates recomputed from them. Equal to the `all` split by construction — the
 * API aggregates the same pbp population per game that it aggregates per season.
 */
export function totalGameLog(games: PlayerGameRow[]): PlayerTotals {
    const plays = games.reduce((t, g) => t + n(g.plays), 0);
    const epa = games.reduce((t, g) => t + n(g.epa), 0);
    const successes = games.reduce((t, g) => t + n(g.successes), 0);
    return {
        games: games.length,
        plays,
        epa,
        successes,
        epa_per_play: plays > 0 ? epa / plays : null,
        success_rate: plays > 0 ? successes / plays : null,
    };
}

export type SeasonRow = Record<string, unknown> & { category: string; season: number };

/** Columns that add across team-seasons; everything else is recomputed from them. */
const ADDITIVE = ['games', 'plays', 'dropbacks', 'sack_adj_yards', 'TEPA', 'yards', 'comp', 'att', 'targets'];

/**
 * A career (or multi-team-season) roll-up for one category: additive columns
 * summed, rate columns recomputed from the sums. `success` is a play-weighted
 * mean, not an average of averages. Returns null for fewer than two rows —
 * there is nothing to roll up, and a duplicate row is noise.
 */
export function rollUpSeasons(rows: SeasonRow[]): Record<string, number | string> | null {
    if (rows.length < 2) return null;
    const out: Record<string, number | string> = { category: rows[0].category };
    for (const k of ADDITIVE) {
        if (rows.some((r) => numberOrNull(r[k]) !== null)) out[k] = rows.reduce((t, r) => t + n(r[k]), 0);
    }
    const plays = n(out.plays);
    const games = n(out.games);
    // a CFB passer's EPA/play is per DROPBACK; every other category is per play
    const epaDenom = rows[0].category === 'passing' ? n(out.dropbacks) : plays;
    const rate = (num: number, den: number) => (den > 0 ? num / den : null);
    const set = (k: string, v: number | null) => { if (v !== null) out[k] = v; };
    set('EPAplay', rate(n(out.TEPA), epaDenom));
    set('yardsdropback', rate(n(out.sack_adj_yards), n(out.dropbacks)));
    set('yardsplay', rate(n(out.yards), plays));
    set('yardsgame', rate(n(out.yards), games));
    set('playsgame', rate(plays, games));
    set('EPAgame', rate(n(out.TEPA), games));
    set('comppct', rate(n(out.comp), n(out.att)));
    set('catchpct', rate(n(out.comp), n(out.targets)));
    // play-weighted, so a 3-game stint cannot drag a 14-game season to its own rate
    set('success', rate(rows.reduce((t, r) => t + n(r.success) * n(r.plays), 0), plays));
    return out;
}

/** The columns a category's line table shows: the leaderboards' own set, games first. */
export function categoryColumns(category: string): [string, string][] {
    const cols = SDV_PLAYER_METRIC_CATEGORIES[category];
    return cols ? [['games', 'G'], ...Object.entries(cols)] : [];
}

/** The `_pct` (0-100) beside a metric, when the producer computed one. */
export function percentileOf(row: Record<string, unknown>, metric: string): number | null {
    const v = numberOrNull(row[`${metric}_pct`]);
    return v === null ? null : Math.min(Math.max(v, 0), 100);
}

/**
 * One metric cell, formatted exactly as the season leaderboards format it
 * (`SDV_PLAYER_METRIC_FORMATTING_VALUES`: multiplier, power10, fixed) so the
 * same number reads identically on both surfaces.
 */
export function formatPlayerMetric(category: string, key: string, value: unknown): string {
    const v = numberOrNull(value);
    if (v === null) return '—';
    const [multiplier, power10, fixed] = SDV_PLAYER_METRIC_FORMATTING_VALUES[category]?.[key] ?? [1, 2, 2];
    return roundNumber(v * multiplier, power10, fixed) + (SDV_PLAYER_PERCENT_COLUMNS.includes(key) ? '%' : '');
}

/**
 * The game-log stat line, per league, because the two box shapes share nothing:
 * CFB's rows are ESPN's box (camelCase, string values), the NFL's are nflverse
 * weekly stats (snake_case, numeric). Mirrors the game page's `PlayerBoxScore`
 * stat-line column -- text on the left, one number per numeric cell after it.
 */
export function gameStatLine(box: Record<string, unknown> | undefined, league: League): string {
    if (!box) return '';
    const s = (k: string) => (box[k] === null || box[k] === undefined || box[k] === '' ? null : String(box[k]));
    const q = (k: string) => numberOrNull(box[k]);
    const parts: string[] = [];
    if (league === 'cfb') {
        const comp = s('completions/passingAttempts');
        if (comp) parts.push(`${comp}, ${s('passingYards') ?? 0} yds, ${s('passingTouchdowns') ?? 0} TD, ${s('interceptions') ?? 0} INT`);
        if (s('rushingAttempts')) parts.push(`${s('rushingAttempts')} car, ${s('rushingYards') ?? 0} yds, ${s('rushingTouchdowns') ?? 0} TD`);
        if (s('receptions')) parts.push(`${s('receptions')} rec, ${s('receivingYards') ?? 0} yds, ${s('receivingTouchdowns') ?? 0} TD`);
        return parts.join('; ');
    }
    if ((q('attempts') ?? 0) > 0) parts.push(`${q('completions') ?? 0}/${q('attempts')}, ${q('passing_yards') ?? 0} yds, ${q('passing_tds') ?? 0} TD, ${q('interceptions') ?? 0} INT`);
    if ((q('carries') ?? 0) > 0) parts.push(`${q('carries')} car, ${q('rushing_yards') ?? 0} yds, ${q('rushing_tds') ?? 0} TD`);
    if ((q('targets') ?? 0) > 0) parts.push(`${q('receptions') ?? 0}/${q('targets')} tgt, ${q('receiving_yards') ?? 0} yds, ${q('receiving_tds') ?? 0} TD`);
    return parts.join('; ');
}
