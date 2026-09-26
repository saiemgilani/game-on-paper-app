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

import { NFL_POST_LABELS, SDV_PLAYER_METRIC_CATEGORIES, SDV_PLAYER_METRIC_FORMATTING_VALUES, SDV_PLAYER_PERCENT_COLUMNS } from './constants';
import { isFeatureEnabled } from './features';
import { leaguePath, type League } from './league';
import { numberOrNull, roundNumber } from './misc';

/** The season-table categories, in the order the page shows them. */
export const PLAYER_CATEGORIES = ['passing', 'rushing', 'receiving'] as const;
export type PlayerCategory = (typeof PLAYER_CATEGORIES)[number];

/**
 * What a player has to do to be ranked in a category, in the season
 * leaderboards' own words (adapted from Pro Football Reference). The producer
 * publishes `_rank`/`_pct` only for rows that clear it, so a player below the
 * bar gets numbers with no ranks -- and the page has to say why rather than
 * show a table of blanks (review on #267).
 */
export const PLAYER_STAT_MINIMUMS: Record<string, string> = {
    passing: 'min. 14 dropbacks per team-game',
    rushing: 'min. 6.25 carries per team-game',
    receiving: 'min. 1.875 targets per team-game',
};

/**
 * A roster height, which both leagues publish as INCHES, as the site writes one
 * ("6-3"). Anything that is not a number of inches reads as absent.
 */
export function formatHeight(v: unknown): string | null {
    const inches = numberOrNull(v);
    if (inches === null || inches <= 0) return null;
    return `${Math.floor(inches / 12)}-${Math.round(inches % 12)}`;
}

/**
 * The seasons, ascending, in which the producer published NO rank for any metric
 * on any of that season's rows -- which is how the payload says "did not qualify";
 * the rows themselves are real, only their ranks and percentiles are withheld. Per
 * season, not all-or-nothing: a career with one unqualified year says which one
 * (review on #267). A traded player's season qualifies if either team row does.
 */
export function unrankedSeasons(rows: Record<string, unknown>[]): number[] {
    const ranked = (r: Record<string, unknown>) => Object.keys(r)
        .some((k) => k.endsWith('_rank') && numberOrNull(r[k]) !== null);
    const seasons = [...new Set(rows.map((r) => Number(r.season)))];
    return seasons.filter((y) => !rows.some((r) => Number(r.season) === y && ranked(r))).sort((a, b) => a - b);
}

/** The name column each category's rows carry, as the leaderboards read it. */
export const PLAYER_NAME_FIELD: Record<PlayerCategory, string> = {
    passing: 'passer_player_name',
    rushing: 'rusher_player_name',
    receiving: 'receiver_player_name',
};

/**
 * `/splits` rows, in the order they are shown; `all` is the population the rest
 * partition. Only the two down-type splits carry a definition -- every other
 * label says what it is -- and it renders as an `<abbr title>`, which is how
 * the rest of the site offers hover copy.
 */
export const PLAYER_SPLITS: { key: string; label: string; title?: string }[] = [
    { key: 'all', label: 'All plays' },
    { key: 'standard_downs', label: 'Standard downs', title: '1st down, 2nd and short of 8, 3rd or 4th and short of 5' },
    { key: 'passing_downs', label: 'Passing downs', title: '2nd and 8 or more, 3rd or 4th and 5 or more' },
    { key: 'red_zone', label: 'Red zone' },
    { key: 'first_half', label: '1st half' },
    { key: 'second_half', label: '2nd half' },
    { key: 'overtime', label: 'Overtime' },
];

/** The two splits that partition `all` by down type, and the three that partition it by period. */
export const SPLIT_PARTITIONS: string[][] = [
    ['standard_downs', 'passing_downs'],
    ['first_half', 'second_half', 'overtime'],
];

/**
 * `/players/<id>` and `/nfl/players/<id>`, segment-exact. The bare `/players` and
 * `/nfl/players` are NOT player pages: they redirect to the season leaderboards,
 * which are public, so gating them 404'd a public URL (review on #267).
 */
export function isPlayerPath(pathname: string): boolean {
    const p = pathname === '/nfl' || pathname.startsWith('/nfl/') ? pathname.slice(4) || '/' : pathname;
    return /^\/players\/[^/]+/.test(p);
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

/**
 * The href a player's name gets, or null when it gets none -- ONE decision for
 * every surface that names a player (`components/player/PlayerLink.astro`, the
 * game page's usage box and its advanced box score). A public link into a gated
 * namespace is a link to the site's 404, so the flag is part of the decision;
 * so is the id shape, because an id the API cannot key on would 404 too.
 */
export function playerHref(
    id: string | number | null | undefined,
    locals: { league?: League; preview?: boolean } | undefined,
    season?: number | null,
): string | null {
    const key = id === null || id === undefined ? '' : String(id);
    const linkable = isEspnAthleteId(key) || (locals?.league === 'nfl' && isGsisId(key));
    if (!linkable || !isFeatureEnabled('player-pages', locals)) return null;
    return playerPath(locals?.league, key, season);
}

/**
 * The game log's week cell. A postseason `week` restarts at 1 in both leagues,
 * so printing it bare labels a bowl game "1": the NFL's five rounds have names
 * (the same list the schedule dropdown offers), and CFB's postseason is one
 * bucket, since which bowl a game was is the game page's business.
 */
export function weekLabel(league: League, seasonType: string | null | undefined, week: number | null | undefined): string {
    const post = /^(post|post-?season|3)$/i.test(String(seasonType ?? ''));
    if (!post) return week === null || week === undefined ? '—' : String(week);
    if (league !== 'nfl') return 'Postseason';
    return NFL_POST_LABELS[Number(week) - 1] ?? 'Postseason';
}

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

/**
 * The ESPN event id for a game-log row, or null when there is none.
 *
 * The CFB log already keys on it; the NFL log keys on nflverse game ids, which
 * the schedule crosswalk maps. Both the row's game link and the live badge
 * resolve the id here, so they can never disagree about which game a row is.
 */
export function espnGameId(row: PlayerGameRow, espnGameIds: Record<string, string> = {}): string | null {
    const id = row.game_id ? String(row.game_id) : null;
    if (!id) return null;
    return (/^\d+$/.test(id) ? id : espnGameIds[id]) ?? null;
}

export interface PlayerTotals {
    games: number;
    plays: number;
    epa: number;
    successes: number;
    epa_per_play: number | null;
    success_rate: number | null;
}

/** A summable reading of a producer column: absent counts as nothing to add. */
const n = (v: unknown): number => numberOrNull(v) ?? 0;

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
 * The three stat-line phrases every surface that prints one uses: the player
 * page's game log (`PlayerGameLog`) and the game page's advanced box score
 * (`game/metrics/PlayerBoxScore`), which used to spell its own. One formatter,
 * so "12/19, 158 yds, 1 TD, 0 INT" reads the same on both. A caller with more
 * to say (xQBR, air yards, fumbles, the game's longest) appends its own tail.
 */
export function passingStatLine(v: { comp?: unknown; att?: unknown; yards?: unknown; tds?: unknown; ints?: unknown }): string {
    const q = (x: unknown) => numberOrNull(x) ?? 0;
    return `${q(v.comp)}/${q(v.att)}, ${q(v.yards)} yds, ${q(v.tds)} TD, ${q(v.ints)} INT`;
}

export function rushingStatLine(v: { carries?: unknown; yards?: unknown; tds?: unknown }): string {
    const q = (x: unknown) => numberOrNull(x) ?? 0;
    return `${q(v.carries)} car, ${q(v.yards)} yds, ${q(v.tds)} TD`;
}

/** `targets` present gives "5/8 tgt"; absent (CFB's box has none) gives "5 rec". */
export function receivingStatLine(v: { receptions?: unknown; targets?: unknown; yards?: unknown; tds?: unknown }): string {
    const q = (x: unknown) => numberOrNull(x) ?? 0;
    const tgt = numberOrNull(v.targets);
    const caught = tgt === null ? `${q(v.receptions)} rec` : `${q(v.receptions)}/${tgt} tgt`;
    return `${caught}, ${q(v.yards)} yds, ${q(v.tds)} TD`;
}

/**
 * The whole-number percentile of `value` in a 101-breakpoint distribution
 * (`players/games/percentiles`, sdv-db): index 0 is the 0th percentile and index
 * 100 the 100th, so the largest index at or below the value IS its percentile.
 * `null` when there is no value or no distribution to read it against.
 */
export function percentileFromBreaks(breaks: number[] | undefined, value: unknown): number | null {
    const v = numberOrNull(value);
    if (v === null || !breaks || breaks.length === 0) return null;
    let lo = 0, hi = breaks.length - 1, at = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (breaks[mid] <= v) { at = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return Math.min(Math.max(at, 0), breaks.length - 1);
}

/**
 * The game-log stat line, per league, because the two box shapes share nothing:
 * CFB's rows are ESPN's box (camelCase, string values), the NFL's are nflverse
 * weekly stats (snake_case, numeric). Both map onto the three phrases above.
 *
 * **Sacks are pass plays, so they are not carries.** ESPN's COLLEGE box follows the
 * NCAA scoring convention and books a sack as a rushing attempt with negative rushing
 * yards -- Kyle McCord's 2024 opener is "5 car, -1 yds" there against four real
 * carries for +8 -- and nothing else on the site counts it that way: sdv-py's rushing
 * box is `rush == True`, which a sack never is (review on #267). So the CFB line reads
 * the play-derived `rusher_carries` / `rusher_yards` / `rusher_tds` the Data API serves
 * beside the box (sdv-db), and only falls back to ESPN's own rushing columns for a row
 * that predates them. nflverse already counts the NFL's way, so the NFL line is the
 * box's.
 */
export function gameStatLine(row: Record<string, unknown> | undefined, league: League): string {
    const box = (row?.box ?? undefined) as Record<string, unknown> | undefined;
    if (!box) return '';
    const q = (k: string) => numberOrNull(box[k]);
    const parts: string[] = [];
    if (league === 'cfb') {
        // ESPN's box is strings, so count on the NUMBER: `"0"` and `"0/0"` are
        // truthy, and printed a phantom "0 car, 0 yds, 0 TD" line for anyone the
        // box listed with an empty category
        const comp = box['completions/passingAttempts'] ? String(box['completions/passingAttempts']) : null;
        const [c, a] = (comp ?? '/').split('/');
        if (comp && (q('passingAttempts') ?? Number(a ?? 0)) > 0) {
            parts.push(passingStatLine({ comp: c, att: a, yards: box.passingYards, tds: box.passingTouchdowns, ints: box.interceptions }));
        }
        const carries = numberOrNull(row?.rusher_carries);
        const rush = carries === null
            ? { carries: box.rushingAttempts, yards: box.rushingYards, tds: box.rushingTouchdowns }
            : { carries, yards: row?.rusher_yards, tds: row?.rusher_tds };
        if ((numberOrNull(rush.carries) ?? 0) > 0) parts.push(rushingStatLine(rush));
        if ((q('receptions') ?? 0) > 0) parts.push(receivingStatLine({ receptions: box.receptions, yards: box.receivingYards, tds: box.receivingTouchdowns }));
        return parts.join('; ');
    }
    if ((q('attempts') ?? 0) > 0) parts.push(passingStatLine({ comp: box.completions, att: box.attempts, yards: box.passing_yards, tds: box.passing_tds, ints: box.interceptions }));
    if ((q('carries') ?? 0) > 0) parts.push(rushingStatLine({ carries: box.carries, yards: box.rushing_yards, tds: box.rushing_tds }));
    if ((q('targets') ?? 0) > 0) parts.push(receivingStatLine({ receptions: box.receptions, targets: box.targets, yards: box.receiving_yards, tds: box.receiving_tds }));
    return parts.join('; ');
}
