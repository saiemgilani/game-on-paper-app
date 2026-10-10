/**
 * "Last updated" stamps for season surfaces. The ISO time comes from
 * `sdvIngestStamp` (resources/sdv.ts): the same /v1/meta stamp that keys the
 * table's KV entry, so the rows on the page are never older than their stamp.
 * Pure (no astro:* imports) so vitest runs it, and reusable by any surface.
 *
 * The server cannot know the viewer's zone, so it writes the time in UTC (what a
 * viewer without JS reads), and the page rewrites it into the viewer's own zone
 * (FreshnessStamp.astro), as the schedule page does with kickoff times.
 */

export interface FreshnessStamp { iso: string; text: string }

/** An ingest time with its zone named. No `timeZone` = the viewer's own, which is what the page shows. */
export function freshnessTime(iso: string, opts: { locale?: string; timeZone?: string } = {}): string {
    return new Intl.DateTimeFormat(opts.locale, {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: opts.timeZone,
    }).format(new Date(iso))
        // some ICU builds put a narrow no-break space before AM/PM; one plain space everywhere
        .replace(/\s+/g, ' ');
}

/** The server-rendered stamp: UTC, labelled. Null when the time is absent or unparseable: a stamp is never invented. */
export function freshnessStamp(iso: string | null | undefined): FreshnessStamp | null {
    if (!iso || !Number.isFinite(Date.parse(iso))) return null;
    return { iso, text: freshnessTime(iso, { locale: 'en-US', timeZone: 'UTC' }) };
}

/** Chart.js subtitle options that draw the stamp inside the canvas, so a saved image carries it. */
export function freshnessSubtitle(text: string | null | undefined) {
    return text
        ? { display: true, text: `Last updated: ${text}`, position: 'bottom' as const, align: 'end' as const, font: { family: '"Chivo", "Fira Mono", serif' } }
        : { display: false };
}
