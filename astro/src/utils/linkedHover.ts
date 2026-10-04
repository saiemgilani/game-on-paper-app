/**
 * Linked hover on the game page. The WP chart, the play tables and the drives
 * table name the same play by its `game_play_number` and the same drive by its
 * ESPN drive id, and talk through four window events, so none imports another.
 */
export const HOVER_PLAY = 'gop:hover-play';   // row -> chart   { n: number | null }
export const HOVER_DRIVE = 'gop:hover-drive'; // row -> chart   { id: string | null }
export const HOVER_WP = 'gop:hover-wp';       // chart -> rows  { n: number | null }
export const SELECT_WP = 'gop:select-wp';     // chart click    { n: number }

export interface WpPoint { game_play_number?: number | null; drive_id?: string | number | null }

/** "#play-<prefix>-<n>" -> n. Prefixes carry hyphens ("most-important-play"). */
export function playNumberFromHref(href: string | null | undefined): number | null {
    const m = href?.match(/^#play-.+-(\d+)$/);
    return m ? Number(m[1]) : null;
}

/** "#drive-<prefix>-<id>" -> id. */
export function driveIdFromHref(href: string | null | undefined): string | null {
    const m = href?.match(/^#drive-[a-z]+-(.+)$/);
    return m ? m[1] : null;
}

/** The WP chart x index of play `n`, or -1 (a kick or a penalty is not on the chart). */
export function wpIndex(points: WpPoint[], n: number | null | undefined): number {
    return n == null ? -1 : points.findIndex((p) => p.game_play_number === n);
}

/** First and last WP x index of a drive's plays. */
export function driveRange(points: WpPoint[], id: string | null | undefined): { from: number; to: number } | null {
    if (id == null) return null;
    let from = -1;
    let to = -1;
    points.forEach((p, i) => {
        if (String(p.drive_id) !== String(id)) return;
        if (from < 0) from = i;
        to = i;
    });
    return from < 0 ? null : { from, to };
}
