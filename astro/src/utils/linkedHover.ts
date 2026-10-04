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

/** A lit row: Bootstrap's active-row tint (it darkens the penalty/turnover/score shades instead of replacing them) plus an underline, so the mark is not colour alone. */
const LIT = ['table-active', 'text-decoration-underline'];

/**
 * The row side: one delegated listener for every play and drive table, and the
 * highlight/scroll for events coming back from the chart. v2 page only. Keyboard
 * focus moving onto a row (its team link) counts as hovering it.
 */
export function installLinkedHover(doc: Document): void {
    const fire = (name: string, detail: object) => window.dispatchEvent(new CustomEvent(name, { detail }));
    const rowOf = (t: EventTarget | null) => (t instanceof Element ? t.closest('tr[href]') : null);

    let current: Element | null = null;
    const leave = () => {
        if (!current) return;
        const wasPlay = playNumberFromHref(current.getAttribute('href')) != null;
        current = null;
        fire(wasPlay ? HOVER_PLAY : HOVER_DRIVE, wasPlay ? { n: null } : { id: null });
    };
    const enter = (e: Event) => {
        const tr = rowOf(e.target);
        if (!tr || tr === current) return;
        leave();
        current = tr;
        const href = tr.getAttribute('href');
        const n = playNumberFromHref(href);
        if (n != null) fire(HOVER_PLAY, { n });
        else fire(HOVER_DRIVE, { id: driveIdFromHref(href) });
    };
    const exit = (e: Event) => {
        const tr = rowOf(e.target);
        if (tr && tr === current && !tr.contains((e as MouseEvent | FocusEvent).relatedTarget as Node | null)) leave();
    };
    doc.addEventListener('mouseover', enter);
    doc.addEventListener('focusin', enter);
    doc.addEventListener('mouseout', exit);
    doc.addEventListener('focusout', exit);

    let lit: Element[] = [];
    window.addEventListener(HOVER_WP, (e) => {
        lit.forEach((r) => r.classList.remove(...LIT));
        const n = (e as CustomEvent<{ n: number | null }>).detail.n;
        lit = n == null ? [] : Array.from(doc.querySelectorAll(`tr[data-play-row][href$="-${n}"]`));
        lit.forEach((r) => r.classList.add(...LIT));
    });
    window.addEventListener(SELECT_WP, (e) => {
        const n = (e as CustomEvent<{ n: number }>).detail.n;
        const row = doc.querySelector(`tr[href="#play-all-${n}"]`);
        const panel = doc.getElementById('all-plays');
        if (!row || !panel) return;
        const go = () => row.scrollIntoView({ block: 'center' });
        if (panel.classList.contains('show')) return go();
        // a collapsed panel has no height yet: scroll once it has opened
        panel.addEventListener('shown.bs.collapse', go, { once: true });
        (window as any).bootstrap?.Collapse.getOrCreateInstance(panel, { toggle: false }).show();
    });
}
