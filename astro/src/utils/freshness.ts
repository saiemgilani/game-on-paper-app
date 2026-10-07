/**
 * "Last updated" stamps for season surfaces. The ISO time comes from
 * `sdvIngestStamp` (resources/sdv.ts): the same /v1/meta stamp that keys the
 * table's KV entry, so the rows on the page are never older than their stamp.
 * Pure (no astro:* imports) so vitest runs it, and reusable by any surface.
 */

export interface FreshnessStamp { iso: string; text: string }

const ET = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

/** The stamp for an ingest time, in ET. Null when the time is absent or unparseable: a stamp is never invented. */
export function freshnessStamp(iso: string | null | undefined): FreshnessStamp | null {
    if (!iso || !Number.isFinite(Date.parse(iso))) return null;
    // some ICU builds put a narrow no-break space before AM/PM; one plain space everywhere
    return { iso, text: `${ET.format(new Date(iso)).replace(/\s+/g, ' ')} ET` };
}

/** Chart.js subtitle options that draw the stamp inside the canvas, so a saved image carries it. */
export function freshnessSubtitle(text: string | null | undefined) {
    return text
        ? { display: true, text: `Last updated: ${text}`, position: 'bottom' as const, align: 'end' as const, font: { family: '"Chivo", "Fira Mono", serif' } }
        : { display: false };
}
