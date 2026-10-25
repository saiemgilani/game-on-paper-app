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
    // The whole NBA surface (pages/nba/**, the Header's league menu entry). Gated once
    // in middleware like 'nfl': a viewer without the preview cookie gets the site's 404
    // for any /nba path. The Blazing the Nets shooting dashboards, read live from the
    // Data API's nba_stats tables. Promote to 'on' when the design owner signs off: that is the flag flip
    // alone (PR 2 and PR 3 shipped the routes; the Header's league menu and the sitemap react to 'on',
    // see nbaHeaderOn.test.ts and sitemapNbaOn.test.ts).
    //
    // Promotion checklist: after the flip deploys, cached football pages keep the old Header (no NBA
    // entry) for up to 6 h + 6 h stale -- purge, or confirm the deploy clears the cache. Before the
    // flip, `?view=live&flags=nba:on` previews the Header entry (isFeaturePublic honours the override).
    'nba': 'preview',
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
    // One team-colour decision per game (utils/misc.ts pickGameColors), a pair
    // per theme, handed to every chart on the game page (WP, EP, drive charts,
    // Deserved Win %) and the matchup radar. Off: each chart keeps its own
    // legacy colours.
    'game-colours': 'preview',
    // The Five Factors panel on the season team page (/year/N/team/<id> and the
    // /nfl twin), under Profile. Only this path adds the factor columns to the
    // team_summaries `select`, so for every other viewer the request, its cache
    // key and the page are exactly what they are today. Promote to 'on' once the
    // table has been reviewed on production data.
    'five-factors': 'preview',
    // The header search box (components/search/SiteSearch.svelte) and the
    // GET /api/search proxy it calls, which 404s for every other viewer. Hits
    // into a gated namespace are dropped per viewer: players while
    // 'player-pages' is off, NFL rows while 'nfl' is off. Prerendered pages
    // (glossary, data-sources, changelog) resolve the flag at build time, so
    // they show no box while this is 'preview'.
    'site-search': 'preview',

    // Game link previews: og:image becomes the API's 1200x630 card for the
    // game's state (utils/shareTags.ts), ?spoilers=off previews without the
    // score (head tags only; the page renders as normal), and GameHeader shows
    // a Share button beside Watch. Read in both game-page twins, PreGamePage and
    // GameHeader. Off: every head is exactly today's and ?spoilers=off is ignored.
    // The card endpoint itself is not gated (routes/shareCard.ts).
    'share-card': 'preview',
    // Nearby-rank lists on the team-season and player pages: for each key
    // metric, the teams or players ranked within five places, the page's own
    // row marked. Promote once both leagues' lists have been reviewed.
    'rank-neighbors': 'preview',
    // The Situational Splits panel on the season team page (/year/N/team/<id> and
    // the /nfl twin): the team's team_tendencies row by down, field, score and
    // game context, for offense or defense, ranked against the season's other
    // rows. Only this path reads team_tendencies there; for every other viewer
    // the page and its requests are unchanged.
    'team-splits': 'preview',
    // Results by Opponent on the season team page (/year/N/team/<id> and the
    // /nfl twin): one bar per game from team_opponent_splits, EPA and Success %
    // per play, dropback and rush, raw or margin, with a dashed season average. Only this path
    // reads team_opponent_splits; every other viewer's requests are unchanged.
    'vs-opponent': 'preview',
    // Chart Builder v2 on /charts/builder (both leagues): one control bar (Season, X, Y, Random axes,
    // Plot) above the chart, and a median crosshair with quadrant labels. Off: today's builder.
    'chart-builder-v2': 'preview',
    // The Record panel on the season team page (/year/N/team/<id> and the /nfl
    // twin): the team's record split by home/away/neutral, conference (division
    // in the NFL), one-score games, vs FBS and vs ranked. It pivots the schedule
    // rows the page already reads for the TeamCard, so no request changes.
    // Promote to 'on' once the table has been reviewed on production data.
    'team-record-splits': 'preview',
    // The team profile's Metric History (/team/<id> and the /nfl twin) draws its boxes from the national
    // distribution of team SEASONS (sdv-db `team_summaries/percentiles`, one read) instead of the team-GAME
    // ladder, and Net Statistics get boxes too. National Trends (/charts/trends and the /nfl twin) draws the same
    // distribution for the metrics team_summaries carries; its other metrics, and either page when the read
    // fails, keep the game ladder. Off: the ladder reads and today's charts, unchanged. Game pages keep the ladder.
    'team-season-bands': 'preview',
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

/**
 * Is the flag public for this request: 'on', or an admin's per-request override. Unlike
 * isFeatureEnabled it is NOT true for a preview-cookie holder, so a 'preview' flag adds nothing to a
 * public-facing surface (the football Header's league menu) for them.
 */
export function isFeaturePublic(name: string, locals: { flagOverrides?: Record<string, boolean> } | undefined): boolean {
    const override = locals?.flagOverrides?.[name];
    return override !== undefined ? override : FLAGS[name] === 'on';
}
