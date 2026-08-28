import { CURRENT_YEAR } from "./constants";

/**
 * Resolve a legacy `/cfb/...` URL to its current path.
 *
 * `/cfb/` was the site's most-shared URL before the Astro rewrite. The
 * redirects map in astro.config.mjs pointed it at `/index`, which is not a
 * route -- so the single most-linked address on the internet to this site
 * answered 404, as did `/cfb/game/<id>` (it resolved to
 * `/game/<id>/index.html`). Everything ever posted to social, forums or chat
 * was dead.
 *
 * Almost every legacy path is just the current path with a `/cfb` prefix, so
 * this strips the prefix and special-cases only the handful that genuinely
 * moved. Doing it as one rule means paths nobody thought to enumerate are
 * covered too.
 *
 * Returns null when the path is not a legacy `/cfb` URL.
 */
export function legacyCfbTarget(pathname: string): string | null {
    if (pathname !== "/cfb" && !pathname.startsWith("/cfb/")) return null;

    // strip the prefix; "/cfb" and "/cfb/" both collapse to the home page
    let rest = pathname.slice("/cfb".length);
    if (rest.endsWith("/")) rest = rest.slice(0, -1);
    if (rest === "" || rest === "/index") return "/";

    // sections that did not survive the rewrite as a straight prefix strip
    const moved: Record<string, string> = {
        "/trends": "/charts/trends",
        "/charts": "/charts/trends",
        "/players": `/year/${CURRENT_YEAR}/players`,
        "/game": "/",          // bare listing; the scoreboard replaced it
        "/year": "/teams/",
        "/team": "/teams/",
        "/teams": "/teams/",   // prerendered, needs its trailing slash
        "/glossary": "/glossary/",
        "/changelog": "/changelog/",
    };
    if (moved[rest]) return moved[rest];

    return rest;
}


/**
 * Rescue paths that the OLD broken redirects sent people to.
 *
 * A 301 is cached by browsers indefinitely and never revalidated, so fixing
 * the source of a bad permanent redirect does not help anyone who already
 * followed it -- their browser keeps resolving the old target locally and
 * never asks us again. The previous config 301'd `/cfb/` to `/index` and
 * `/cfb/game/<id>` to `/game/<id>/index.html`, neither of which is a route.
 * Every visitor who hit one of those is pinned to a 404 forever unless those
 * targets themselves resolve.
 *
 * So these are not legacy URLs anyone ever published -- they are the wreckage
 * of the bug, and they have to keep working essentially forever.
 */
export function staleRedirectTarget(pathname: string): string | null {
    if (pathname === "/index" || pathname === "/index/" || pathname === "/index.html") {
        return "/";
    }
    // "/game/401752921/index.html" -> "/game/401752921"
    if (pathname.endsWith("/index.html")) {
        const stripped = pathname.slice(0, -"/index.html".length);
        return stripped === "" ? "/" : stripped;
    }
    return null;
}
