/**
 * Helpers for the usage / situational / special-teams box sections
 * (sportsdataverse.football.usage_box). Pure functions so the components
 * stay declarative and the rules are unit-testable.
 */
import type { ProcessedBoxScore } from '../resources/python';

/** Every section sportsdataverse.football.usage_box emits. */
export const USAGE_SECTIONS = [
    'player_usage', 'position_group_usage', 'tackles', 'position_group_tackles', 'team_usage', 'drive_scripting',
    'st_kickers', 'st_punters', 'st_returners', 'st_blocks', 'st_team',
] as const;

/** The sections the two-team Situational & Special Teams panel reads. */
export const SITUATIONAL_SECTIONS = ['team_usage', 'drive_scripting', 'st_team'] as const;

const anyRows = (box: Partial<ProcessedBoxScore> | null | undefined, keys: readonly string[]): boolean =>
    !!box && keys.some((k) => Array.isArray((box as any)[k]) && (box as any)[k].length > 0);

/** The usage box is "present" when the processor emitted any section with at least one row. */
export function hasUsageBox(box: Partial<ProcessedBoxScore> | null | undefined): boolean {
    return anyRows(box, USAGE_SECTIONS);
}

/** Whether SituationalSplits has a table to render (so the page can skip an empty panel). */
export function hasSituationalSplits(box: Partial<ProcessedBoxScore> | null | undefined): boolean {
    return anyRows(box, SITUATIONAL_SECTIONS);
}

/** Rows of one team, by the section's team column. */
export function teamRows<T extends Record<string, any>>(rows: T[] | undefined, teamId: string | number, key = 'pos_team'): T[] {
    if (!Array.isArray(rows)) return [];
    return rows.filter((r) => String(r?.[key]) === String(teamId));
}

/** Descending sort on a numeric key, nulls last, stable on the name. */
export function sortDesc<T extends Record<string, any>>(rows: T[], key: string, nameKey = 'player_name'): T[] {
    return [...rows].sort((a, b) => {
        const av = a?.[key], bv = b?.[key];
        const an = av == null || Number.isNaN(Number(av)), bn = bv == null || Number.isNaN(Number(bv));
        if (an && bn) return String(a?.[nameKey] ?? '').localeCompare(String(b?.[nameKey] ?? ''));
        if (an) return 1;
        if (bn) return -1;
        return Number(bv) - Number(av) || String(a?.[nameKey] ?? '').localeCompare(String(b?.[nameKey] ?? ''));
    });
}

/** 0.4123 -> "41.2%"; null -> "—". */
export function pct(v: number | null | undefined, digits = 1): string {
    if (v == null || Number.isNaN(Number(v))) return '—';
    return `${(Number(v) * 100).toFixed(digits)}%`;
}

/** A signed count: +1.4 / -0.6 / 0.0; null -> "—". */
export function signed(v: number | null | undefined, digits = 1): string {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Number(v);
    const s = n.toFixed(digits);
    return n > 0 ? `+${s}` : s;
}

/** A plain number with fixed digits; null -> "—". */
export function num(v: number | null | undefined, digits = 1): string {
    if (v == null || Number.isNaN(Number(v))) return '—';
    return Number(v).toFixed(digits);
}

/** "made/att" with a null-safe zero. */
export function madeOf(made: number | null | undefined, att: number | null | undefined): string {
    return `${made ?? 0}/${att ?? 0}`;
}

/** The scripted / non-scripted pair for a team, keyed by script. */
export function scriptSplit<T extends { script: string }>(rows: T[] | undefined, teamId: string | number): Record<string, T | undefined> {
    const mine = teamRows(rows as any[], teamId) as T[];
    return {
        scripted: mine.find((r) => r.script === 'scripted'),
        non_scripted: mine.find((r) => r.script === 'non_scripted'),
    };
}
