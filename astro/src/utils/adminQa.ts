// The QA tab on /admin (#qa): the validation signal every /process response
// carries, per game and per rule. The tab is a client script like every other
// tab in pages/admin/index.astro, so the tables are built here as plain data
// for that page's `table()` helper -- pure functions, and therefore testable.
// `GET /admin/api/qa` is the window-scoped half (python/gop_routes.py holds the
// SQL); `GET /admin/api/qa-season` is the published season.
import { LEAGUES, leaguePath, type League } from './league';
import { escapeHtml as esc, generateColorRampValue, roundNumber } from './misc';

export interface QaGameRow {
    game_id: string
    /** 'cfb' | 'nfl', read off the request's route pattern: gop.request_log has
     *  no league column, and /process is mounted once per league. */
    league: string | null
    matchup: string | null
    status: string | null
    away_score: number | null
    home_score: number | null
    last_poll: string
    age_s: number
    qa_ok: boolean | null
    qa_errors: number | null
    qa_warnings: number | null
    qa_source: string | null
    qa_fallback: boolean | null
    qa_rules: string[] | null
}

export interface QaRuleRow { rule: string, day: string, n: number, games: number }

export interface QaAdmin {
    games: QaGameRow[]
    rules: QaRuleRow[]
    totals: { checks?: number, clean?: number, games?: number, fallbacks?: number }
    days: number
}

export interface QaSeasonRow {
    game_id: string
    league: League
    source: string | null
    processing_version: string | null
    n_errors: number
    n_warnings: number
    failed_rule_ids: string[] | null
}

export interface QaSeason { rows: QaSeasonRow[], season: number, ok: boolean }

/** A `table()` cell: raw HTML, or HTML plus a class for the <td>. */
export type QaCell = string | { v: string, cls: string }
export interface QaTable {
    head: string[]
    rows: { cells: QaCell[] }[]
    /** What to say under an empty table. A failed query and a clean window both
     *  render no rows, and they are not the same claim. */
    note: string
}

/** Windows the rule histogram offers. Only this section is window-scoped. */
export const QA_WINDOWS = [1, 7, 14, 30];
/** Every league the site renders: /admin is not under /nfl, so nothing but the
 *  row itself can say which league a game belongs to. */
export const QA_LEAGUES = Object.keys(LEAGUES) as League[];
// Error counts shade against a fixed five, not the worst row: a scale that
// moved with the data would make the same colour mean a different thing on
// every load. The rule matrix DOES shade relative to its own worst cell --
// that is what a histogram is for.
const ERROR_SCALE = 5;

export const asLeague = (value: string | null | undefined): League =>
    (value != null && value in LEAGUES ? value as League : 'cfb');

export const statusText = (s: string | null) =>
    (s ?? '').replace('STATUS_', '').replaceAll('_', ' ').toLowerCase() || 'unknown';

export const ago = (seconds: number) =>
    seconds < 90 ? `${Math.round(seconds)}s` : seconds < 5400 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;

// The day buckets arrive as UTC instants and are labelled in the viewer's
// timezone -- the same reason the schedule page localises kickoffs. The bare
// month-day of the instant is the fallback if it will not parse.
const DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric' });
export function qaDayLabel(day: string): string {
    const d = new Date(day);
    return isNaN(d.getTime()) ? String(day).slice(5, 10) : DAY_LABEL.format(d);
}

const ramp = (n: number | null, max: number): string =>
    (n === null ? null : generateColorRampValue(Math.min(n, max), max, true)) ?? '';

const note = (ok: boolean, empty: boolean, emptyText: string, failText: string) =>
    (!ok ? failText : empty ? emptyText : '');

/** Last verdict per game seen in the past 24 hours, one row per game. */
export function qaGamesTable(qa: QaAdmin, ok: boolean): QaTable {
    return {
        head: ['Game', 'League', 'Status', 'Source', 'Errors', 'Warnings', 'Rules', 'Last poll'],
        rows: qa.games.map((row) => {
            const lg = asLeague(row.league);
            return { cells: [
                `<a href="${leaguePath(lg, `/game/${esc(row.game_id)}`)}" target="_blank">${esc(row.matchup ?? row.game_id)}</a>`,
                LEAGUES[lg].shortName,
                esc(statusText(row.status)),
                esc(row.qa_source ?? '—') + (row.qa_fallback ? ' (fallback)' : ''),
                { v: row.qa_errors === null ? '—' : String(row.qa_errors), cls: ramp(row.qa_errors, ERROR_SCALE) },
                row.qa_warnings === null ? '—' : String(row.qa_warnings),
                `<span class="admin-muted">${esc((row.qa_rules ?? []).join(', ') || '—')}</span>`,
                ago(row.age_s),
            ] };
        }),
        note: note(ok, qa.games.length === 0,
            'No game has been checked in the past 24 hours.',
            'The telemetry store did not answer. This table is empty because the query failed, not because nothing was found.'),
    };
}

/** One row per rule, one column per day: the histogram for the chosen window. */
export function qaRulesTable(qa: QaAdmin, ok: boolean): QaTable {
    const days = [...new Set(qa.rules.map((r) => String(r.day)))].sort();
    const byRule = new Map<string, Map<string, QaRuleRow>>();
    for (const row of qa.rules) {
        if (!byRule.has(row.rule)) byRule.set(row.rule, new Map());
        byRule.get(row.rule)!.set(String(row.day), row);
    }
    const worstCell = Math.max(1, ...qa.rules.map((r) => r.n));
    const rows = [...byRule.entries()]
        .map(([rule, cells]) => ({
            rule,
            cells,
            total: [...cells.values()].reduce((a, c) => a + c.n, 0),
            games: [...cells.values()].reduce((a, c) => a + c.games, 0),
        }))
        .sort((a, b) => b.total - a.total)
        .map((r) => ({ cells: [
            esc(r.rule),
            ...days.map((day) => ({
                v: String(r.cells.get(day)?.n ?? ''),
                cls: r.cells.has(day) ? ramp(r.cells.get(day)!.n, worstCell) : '',
            })),
            String(r.total),
            String(r.games),
        ] as QaCell[] }));
    return {
        head: ['Rule', ...days.map(qaDayLabel), 'Total', 'Games'],
        rows,
        note: note(ok, rows.length === 0, 'No rule fired in this window.',
            'The telemetry store did not answer. This table is empty because the query failed, not because nothing was found.'),
    };
}

/** The window's headline: checks, how many were clean, how many failed over. */
export function qaSummary(qa: QaAdmin, ok: boolean): string {
    if (!ok) return '';
    const clean = qa.totals.checks ? 100 * (qa.totals.clean ?? 0) / qa.totals.checks : null;
    return `${qa.totals.checks ?? 0} checks on ${qa.totals.games ?? 0} games, `
        + `${clean === null ? '—' : roundNumber(clean, 1, 1)}% clean, `
        + `${qa.totals.fallbacks ?? 0} served by a fallback source.`;
}

/** Published per-game verdicts for the season, from the release builds. */
export function qaSeasonTable(season: QaSeason): QaTable {
    return {
        head: ['Game', 'League', 'Source', 'Version', 'Errors', 'Warnings', 'Rules'],
        rows: season.rows.map((row) => {
            const lg = asLeague(row.league);
            return { cells: [
                `<a href="${leaguePath(lg, `/game/${esc(row.game_id)}`)}" target="_blank">${esc(row.game_id)}</a>`,
                LEAGUES[lg].shortName,
                esc(row.source ?? '—'),
                esc(row.processing_version ?? '—'),
                { v: String(row.n_errors), cls: ramp(row.n_errors, ERROR_SCALE) },
                String(row.n_warnings),
                `<span class="admin-muted">${esc((row.failed_rule_ids ?? []).join(', ') || '—')}</span>`,
            ] };
        }),
        note: note(season.ok, season.rows.length === 0,
            'Not published yet: the season view fills in when the release builds publish their QA asset. Until then the tables above are the only record, and they only cover games the site rendered.',
            'The Sportsdataverse API did not answer. This panel is empty because the query failed, not because the season has no findings.'),
    };
}
