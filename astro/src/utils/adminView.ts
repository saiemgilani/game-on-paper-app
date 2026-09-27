/**
 * Admin-only per-request view controls, read off the query string.
 *
 * These are ADMIN TOOLS, not a preview feature: they render only for a request
 * the middleware authenticated with the `gop_admin` session cookie (see
 * utils/adminSession.ts), and they are never promoted to the public. For any
 * other viewer the parameters below are inert -- the middleware never reads
 * them, so the page, the API request and the Workers cache key are exactly
 * what they are today.
 *
 *   ?view=live|preview    the base flag state for THIS request: `live` renders
 *                         the page an anonymous visitor gets (every 'preview'
 *                         entry in FLAGS off) even though the admin holds a
 *                         preview cookie; `preview` renders them all on.
 *   ?flags=a:on,b:off     per-flag overrides applied on top of that base.
 *   ?source=<name>        which processing source the API should use
 *                         (routes/game.ts; the 'source-switch' flag path).
 *
 * The override lands on `locals.preview` / `locals.flagOverrides`, so every
 * existing `isFeatureEnabled` call follows it -- the twin choice in
 * GameRoute.astro and the middleware's own namespace gates included.
 */

export const VIEW_PARAM = 'view';
export const FLAGS_PARAM = 'flags';
export const SOURCE_PARAM = 'source';

export type AdminView = 'live' | 'preview';

/** `game-page-v2:on,coaches:off` -> `{ 'game-page-v2': true, coaches: false }`. */
export function parseFlagOverrides(raw: string | null | undefined): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const entry of (raw ?? '').split(',')) {
        const [name, state] = entry.trim().split(':');
        // Anything that is not exactly `name:on` or `name:off` is dropped: a
        // half-typed parameter must not silently flip a flag.
        if (name && (state === 'on' || state === 'off')) out[name] = state === 'on';
    }
    return out;
}

export function serializeFlagOverrides(overrides: Record<string, boolean>): string {
    return Object.entries(overrides).map(([n, on]) => `${n}:${on ? 'on' : 'off'}`).join(',');
}

/**
 * Apply the overrides to `locals`. The CALLER decides who is an admin -- this
 * is only ever reached from the middleware's authenticated branch.
 */
export function applyAdminView(url: URL, locals: { preview?: boolean; flagOverrides?: Record<string, boolean> }): void {
    const view = url.searchParams.get(VIEW_PARAM);
    if (view === 'live') locals.preview = false;
    else if (view === 'preview') locals.preview = true;
    const overrides = parseFlagOverrides(url.searchParams.get(FLAGS_PARAM));
    if (Object.keys(overrides).length) locals.flagOverrides = overrides;
}

/** Which base state the pills should show as selected. */
export function currentView(url: URL, locals: { preview?: boolean } | undefined): AdminView {
    const view = url.searchParams.get(VIEW_PARAM);
    if (view === 'live' || view === 'preview') return view;
    return locals?.preview === true ? 'preview' : 'live';
}

/**
 * This URL with one control changed -- the href behind a pill or a dropdown
 * option. `null` clears a parameter. Every other parameter is preserved so the
 * controls compose (Preview x Shield, Live x ESPN, ...).
 */
export function adminToolsHref(url: URL, patch: {
    view?: AdminView | null;
    flags?: Record<string, boolean | null>;
    source?: string | null;
}): string {
    const next = new URL(url.toString());
    if ('view' in patch) {
        if (patch.view) next.searchParams.set(VIEW_PARAM, patch.view);
        else next.searchParams.delete(VIEW_PARAM);
    }
    if (patch.flags) {
        const merged = parseFlagOverrides(next.searchParams.get(FLAGS_PARAM));
        for (const [name, state] of Object.entries(patch.flags)) {
            if (state === null) delete merged[name];
            else merged[name] = state;
        }
        const serialized = serializeFlagOverrides(merged);
        if (serialized) next.searchParams.set(FLAGS_PARAM, serialized);
        else next.searchParams.delete(FLAGS_PARAM);
    }
    if ('source' in patch) {
        if (patch.source) next.searchParams.set(SOURCE_PARAM, patch.source);
        else next.searchParams.delete(SOURCE_PARAM);
    }
    return next.pathname + next.search;
}
