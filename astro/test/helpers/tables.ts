/**
 * Helpers for the render-level table contract tests (V3b).
 *
 * The tests render a real component with a real processed-game payload and then
 * read the numbers back out of the HTML. Everything here is about that second
 * half: turning rendered markup into the strings a person would see, so an
 * assertion can compare them against the payload field the header claims.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

/** The entities the components emit, back to the characters a reader sees. */
export function decodeEntities(s: string): string {
    return s
        .replace(/&ndash;/g, '–')
        .replace(/&mdash;/g, '—')
        .replace(/&emsp;/g, ' ')
        .replace(/&ensp;/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&middot;/g, '·')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#8212;/g, '—')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/** Visible text of a markup fragment, whitespace-collapsed. */
export function text(html: string): string {
    return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface ParsedTable {
    headers: string[];
    /** One entry per `<tr>`, cell text in document order (`th` and `td` alike). */
    rows: string[][];
    /** The raw `<tr>` markup, same indexing as `rows`. */
    rowHtml: string[];
}

/**
 * The n-th `<table>` of a fragment, as header and body text.
 *
 * A regex rather than a DOM: vitest here has no jsdom, the components emit
 * flat, non-nested tables, and the alternative (adding a DOM dependency for
 * four assertions) is a heavier gate than the thing it checks.
 */
export function parseTable(html: string, index = 0): ParsedTable {
    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
    const table = tables[index];
    if (!table) throw new Error(`no <table> at index ${index} (found ${tables.length})`);
    const rowHtml = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
    const rows = rowHtml.map((r) => [...r.matchAll(/<(?:td|th)\b[\s\S]*?<\/(?:td|th)>/g)].map((c) => text(c[0])));
    const head = table.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? rowHtml[0] ?? '';
    const headers = [...head.matchAll(/<(?:td|th)\b[\s\S]*?<\/(?:td|th)>/g)].map((c) => text(c[0]));
    return { headers, rows, rowHtml };
}

export function countTables(html: string): number {
    return (html.match(/<table[\s>]/g) ?? []).length;
}

/** Every number in a fragment, in document order — the twin-parity comparison unit. */
export function numbers(html: string): string[] {
    return (text(html).match(/-?\d+(?:\.\d+)?/g) ?? []);
}

/** A gzipped JSON fixture next to `test/fixtures`. */
export function loadGzJson(name: string): any {
    return JSON.parse(gunzipSync(readFileSync(new URL(`../fixtures/${name}`, import.meta.url))).toString());
}

export function loadJson(name: string): any {
    return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)).toString());
}

/** `expect(a).toBeCloseTo(b)` for values that may be null on either side. */
export function approx(a: unknown, b: unknown, tol = 1e-6): boolean {
    if (a == null || b == null) return a == null && b == null;
    return Math.abs(Number(a) - Number(b)) <= tol;
}

/**
 * `Astro.locals` for a container render. The real `Locals` also carries the
 * Cloudflare `cfContext`, which nothing under test reads, so the cast keeps the
 * call sites to the one field that matters.
 */
export const locals = (league: string) => ({ league }) as any;
