// In-development features, hidden behind admin preview mode.
//
//   'off'      -> rendered for nobody (parked work)
//   'preview'  -> rendered only when the viewer holds a valid preview cookie
//                 (toggled from /admin; see utils/preview.ts)
//   'on'       -> rendered for everyone
//
// Ship a feature as 'preview', eyeball it on production data via the admin
// panel's Preview toggle, then PROMOTE it with a one-line 'preview' -> 'on'
// change -- promotion stays a reviewed commit, and the public path costs
// nothing (no store reads; the cookie check happens once in middleware).
//
// Usage in a component or page:
//   import { isFeatureEnabled } from '../utils/features';
//   { isFeatureEnabled('my-flag', Astro.locals) && <NewThing /> }
//
// An authenticated admin can override the resolved state for ONE request from
// the query string (?view=live|preview, ?flags=name:on,name:off -- see
// utils/adminView.ts). That is an admin tool, not a flag state: the middleware
// reads those parameters only on a request carrying a valid admin session
// cookie, so nothing about a public request changes.

export type FeatureState = 'off' | 'preview' | 'on';

export const FLAGS: Record<string, FeatureState> = {
    // The rebuilt game page (#189) AND play marks (#187): public traffic gets
    // the frozen pre-v2 snapshot (components/game/classic/); the preview cookie
    // renders the new tree. Promote by flipping to 'on' and deleting classic/.
    'game-page-v2': 'preview',
    // Mobile scoreboard: one-line rows (GameCompactRow) instead of cards under
    // 768px. Desktop keeps the card grid either way.
    'scoreboard-compact': 'preview',
    // The whole NFL surface (pages/nfl/**, the header's league switch, the
    // sitemap's /nfl URLs). Gated once in middleware: a viewer without the
    // preview cookie gets the site's 404 for any /nfl path. Promote to 'on'
    // when the NFL launches -- nothing else changes.
    'nfl': 'preview',
    // The head-coach boards for both leagues: /year/N/coaches/*, /coaches/* and
    // their /nfl twins, the header's Head Coaches section and the sitemap's
    // coach URLs. Gated in middleware exactly like 'nfl' (utils/coaches.ts
    // isCoachBoardPath). Promote to 'on' once the coach attribution is trusted.
    'coaches': 'preview',
    // The play processor's source switch (football-sources Stage 4): the game
    // page may ask the API to process a game from an alternate feed
    // (?source=shield|cbs|yahoo|fox|ncaa, the sportsdataverse-py contract's
    // registry) and renders from the API's own header when ESPN's cdn is down.
    // Nothing public changes while this is 'preview': only this path sends
    // `?source=` to the API, so the request, its cache key and the response are
    // exactly what they are today for every other viewer. Promote to 'on' once
    // an alternate adapter is trusted end to end.
    'source-switch': 'preview',
    // Individual player pages: /players/<espn id> and the /nfl twin, plus the
    // hrefs the leaderboard rows and the game-page usage box grow to reach them.
    // Gated in middleware exactly like 'nfl' and 'coaches' (utils/players.ts
    // isPlayerPath); the links are gated in their components, because a public
    // link into a 404 namespace is worse than no link. Promote to 'on' once the
    // player-keyed Data API routes are live and the sitemap block is filled in.
    'player-pages': 'preview',
    // Game-page header links: the team names in the h1 go to /team/<id>, and the
    // Back button goes to the game's own week. Links on text the page already
    // shows, no new element. Read in GameHeader.astro, which both game-page
    // twins and the pregame page import.
    'game-links': 'preview',
};

/** The flags an admin can flip per request -- what the admin tools list. */
export const PREVIEW_FLAG_NAMES = Object.keys(FLAGS).filter((n) => FLAGS[n] === 'preview');

export function isFeatureEnabled(
    name: string,
    locals: { preview?: boolean; flagOverrides?: Record<string, boolean> } | undefined,
): boolean {
    // An admin's per-request override wins over both the flag state and the
    // preview cookie; it is only ever populated for an authenticated admin.
    const override = locals?.flagOverrides?.[name];
    if (override !== undefined) return override;
    const state = FLAGS[name] ?? 'off';
    if (state === 'on') return true;
    if (state === 'preview') return locals?.preview === true;
    return false;
}
