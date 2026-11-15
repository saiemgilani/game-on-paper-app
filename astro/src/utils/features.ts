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
    'game-page-v2': 'on',
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
    // The whole WNBA surface (pages/wnba/**: the teams-index landing, the scoreboard, game pages and the shooting pages; its
    // Header menu and league-switch entry), gated in middleware like 'nba'. Promote to 'on' when the design owner signs off,
    // in a one-line commit as for 'nba': the sitemap then lists /wnba, the Header's pages and the team pages.
    'wnba': 'preview',
    // Men's college basketball (pages/mbb/**: the teams-index landing, the scoreboard, game pages and the shooting pages;
    // its Header menu and league-switch entry), gated in middleware like 'nba'. Promote to 'on' when the design owner signs
    // off, in a one-line commit: the sitemap then lists /mbb, the Header's pages and the 365 member team pages.
    'mbb': 'preview',
    // Women's college basketball (pages/wbb/**: the teams-index landing, the scoreboard, game pages and the shooting pages;
    // its Header menu and league-switch entry), gated in middleware like 'nba'. Promote to 'on' when the design owner signs
    // off, in a one-line commit: the sitemap then lists /wbb, the Header's pages and the season's 363 team pages (D38).
    'wbb': 'preview',
    // BB-G47's league hub at /nba, /wnba, /mbb and /wbb: today's games (the scoreboard's own read and cards, live first, then
    // upcoming, then final) with the market line and win probability from `{league}.game_lines` (BB-D33) where it has the
    // game, and an index of the league's pages. Off: the landing is today's (the NBA's featured team, the others' teams
    // index), byte for byte, and no game_lines read is made.
    'bball-hub': 'preview',
    // BB-G48's "Tonight" on that hub (so it shows only where 'bball-hub' is on too): the night's five best games by game score
    // from `{league}.player_box` (the board's day once the nightly has its finals, else the day before), linked to their game
    // pages, and a win-probability sparkline from `{league}.play_wp` on each final's card. Off: the hub of 'bball-hub' alone,
    // byte for byte, with no player_box or play_wp read.
    'bball-hub-tonight': 'preview',
    // BB-G49's dashboards on that hub (again only where 'bball-hub' is on): the season's top 25 by WAR from player_war (the
    // league's stats schema) and "follow a team", a picker whose choice the browser keeps (localStorage, no account, no new
    // route) and whose card is the team's last and next game, record and rank from `{league}.schedule`. Off: no such section,
    // byte for byte, and no player_war or schedule read.
    'bball-hub-dashboards': 'preview',
    // The game excitement index on the basketball game pages (nba/wnba/mbb/wbb, so inside each league's flag): the
    // processor's GEI (python/nba_game.py, sdv-py game_excitement) on the WP chart's line, as football prints it
    // for a final. Off: the chart island's props are today's. A Data API-served game page still has no GEI
    // (resources/nbaGame.ts fromDataApi).
    'bball-gei': 'preview',
    // The Best Games board (BB-G29): /<league>/best-games and its Header entry, inside each league's flag. sdv-db's
    // `{lg}.game_excitement` by season, day range and team. Its own flag, so promoting the game pages' GEI line does not
    // ship the board. Off: the board is the site's 404 and the Header is today's.
    'bball-best-games': 'preview',
    // College bracketology (BB-G22): /mbb/bracketology and /wbb/bracketology and their Header entry, inside each league's
    // flag. sdv-db's daily college snapshots (season_sims, bracketology, team_resume): the projected field on the CFP
    // page's bracket component, the bubble, conference standings with projections and the team sheets. Off: the pages
    // are the site's 404 and the Header is today's.
    'bball-bracketology': 'preview',
    // Pro standings and playoff picture (BB-G23): /nba/standings and /wnba/standings and their Header entry, inside each
    // league's flag. sdv-db's daily pro season snapshots (season_sims, season_standings, lottery_odds): the official
    // standings with playoff / play-in / lottery odds, the seed distribution, the NBA's divisions, the first round on the
    // CFP page's bracket component and the draft lottery. Off: the pages are the site's 404 and the Header is today's.
    'bball-playoff-picture': 'preview',
    // The team season block (BB-G5) on /<league>/team/[id], inside each league's flag: the record, the season rates with
    // ranks, the all / home / away / close / clutch splits and the schedule with each game's four factors (sdv-db's
    // team_season_rates, team_strength and game_team_rates); college adds adjusted efficiency margin and tempo. Off: no
    // read and the team page is today's, byte for byte.
    'bball-team-season': 'preview',
    // The team page's Lineups tab (BB-G3) on /<league>/team/[id], inside each league's flag: the team's 5-, 3- and 2-man
    // units over a possession gate, per 100 possessions or in totals (sdv-db's lineup_seasons). Off: no read and the team
    // page is today's, byte for byte.
    'bball-lineups': 'preview',
    // The team page's On/Off and WOWY section (BB-G4) on /<league>/team/[id], inside each league's flag: each player's team
    // on and off the floor and one player's teammate pairs (sdv-db's player_on_off and player_wowy). Off: no read and the
    // team page is today's, byte for byte.
    'bball-on-off': 'preview',
    // The Situations sections (BB-G25) on /<league>/team/[id] and /<league>/players/[id], inside each league's flag: one
    // Situation select of URLs (All / Clutch / by period / Leading / Tied / Trailing / Home / Away / Transition / Half court /
    // Garbage time out / vs top N) over the team, its players and its five-man units, or over the player's own rows (sdv-db's
    // situational_team / _player / _lineup); and on /<league>/game/[id] for a final, a Situations panel over both teams' rows in
    // the game (situational_team_games). Off: no read and the pages are today's, byte for byte.
    'bball-situational': 'preview',
    // Points over expected (BB-G15) inside each league's flag: a table in the game page's Four factors panel (each team), a
    // section on /<league>/team/[id] (the team and its shooters) and a line on /<league>/players/[id], from sdv-db's
    // shot_quality_game / shot_quality_season (BB-D9). Off: no read and the three pages are today's, byte for byte.
    'bball-poe': 'preview',
    // The player page's Impact panel (BB-G6) inside each league's flag: RAPM, adjusted RAPM, SPM, BPM, BOBAN and WAR with
    // their possessions from sdv-db's player_impact (NBA/WNBA). Off: no read and the player page is today's, byte for byte.
    // Stays 'preview' until the producer ships player_impact's <m>_rank / <m>_pct (Akshay on #408); the Rank columns and
    // shading then appear with no GOP change. College's panel: RAPM (ncaa_rapm, through ncaa_player_crosswalk) and box BPM.
    'bball-impact': 'preview',
    // The player page's On/Off section (BB-G7) on /<league>/players/[id], inside each league's flag: his team on and
    // off the floor and his top teammates with and without him (sdv-db's player_on_off and player_wowy). College's rows
    // are keyed by stats.ncaa.org ids and go through ncaa_player_crosswalk (BB-D37). Off: no read and the player page is
    // today's, byte for byte.
    'bball-player-on-off': 'preview',
    // Play-style archetype chips (BB-G17) inside each league's flag, from sdv-db's player_play_styles / team_play_styles
    // (BB-D20): offense and defense on /nba/players/[id], one box-based style on the college player pages, defense with its
    // runner-up on /nba/team/[id]. No WNBA table and no team offense archetype. Off: no read and both pages are today's, byte
    // for byte.
    'bball-play-styles': 'preview',
    // WAR, VORP and EPV added (BB-G27) inside each league's flag: the player page's Value block, WAR always with its 90%
    // interval, from sdv-db's player_war (BB-D26) and, from 2021-22, epv_player_seasons (sdv-db #223); it closes the
    // Impact panel (a section of its own with 'bball-impact' off), whose own WAR then reads "Impact WAR". Off: no read and the player page is today's, byte for byte.
    'bball-war': 'preview',
    // Basketball player compare (BB-G13) inside each league's flag: /<league>/players/compare?ids=a,b&season=N, football's
    // compare page ('player-compare', #359) with up to four cards of the Impact, Value and shooting rows the player page
    // reads, plus the Compare button on /<league>/players/[id]. Off: the page is the site's 404 and the player page is
    // today's, byte for byte.
    'bball-compare': 'preview',
    // The NBA player page's Play types and Defense panels (BB-G19), from 2015-16: his Synergy play types at both ends with
    // stats.nba.com's frequency, PPP and percentile (sdv-db nba_stats.synergy), his hustle line (hustle_player) and, from
    // 2017-18, his matchups by position and the players he guarded most (matchups_rollup, matchups). Off: no read and the
    // player page is today's, byte for byte.
    'bball-play-types': 'preview',
    // The player page's Career panel (BB-G54) inside each league's flag: one row per season of sdv-db's player_war (rating,
    // WAR, VORP; all four leagues) and, for the NBA/WNBA, player_impact's RAPM and BPM. A click on a ranked number opens its
    // producer rank, cohort, percentile and sample; the foot row is his percentile by season. Off: no read, today's page.
    'bball-career': 'preview',
    // The player and team pages' Shot profile (BB-G51) inside each league's flag: rim / mid-range / corner 3 / above-the-break
    // 3 attempts, share, FG% and assisted share with the producer's ranks, from sdv-db's player_shot_zones / team_shot_zones
    // (BB-D35), the team's allowed side, and where the points come from. Off: no read, today's pages byte for byte.
    'bball-shot-profile': 'preview',
    // Season impact and Current impact (BB-G56) as two rows of the NBA player page's Impact table, inside 'nba': the
    // season's prior-informed RAPM (player_impact's reml_rapm, BB-D38) beside his expected impact as of the season's latest
    // weekly date (current_impact, BB-D39), each with its prior in the hover and Current impact's date in the table caption.
    // NBA from 2006-07 only. Off: no read and the player page is today's, byte for byte.
    'bball-current-impact': 'preview',
    // Team strength (BB-G24) inside the season block, so it needs 'bball-team-season' too: adjusted net rating, strength
    // of schedule, strength of victory and pace, each with its league rank (sdv-db's team_strength, BB-D19). Off: the
    // block is BB-G5's, byte for byte.
    'bball-team-strength': 'preview',
    // BB-G14: the game-set filter (?games=all|home|away|close|clutch|conference|wins|losses|last5|last10|last20) on
    // /<league>/team/[id], inside 'bball-team-season' (All / Home / Away / Close / Clutch are that block's producer split
    // rows; Wins / Losses / last N / college Conference games sum the team's team_game_possessions rows, read
    // only for those sets), and on /<league>/players/[id] over the page's own per-game shot rows (no extra read; the
    // explorer starts from the set). Off: ?games= is never read, the pages and their requests are unchanged.
    'bball-game-set': 'preview',
    // BB-G50: advanced game logs. /<league>/players/[id]: each game's box with TS%, usage, on-court possessions, +/- and
    // ratings, points over expected and EPV added (game_player_rates, shot_quality_game, game_player_impact,
    // epv_player_games; college reaches the last two through ncaa_player_crosswalk). /<league>/team/[id], inside
    // 'bball-team-season': each game's four factors and ratings plus game_flow. Cells shaded against the season, a consistency line, and under
    // 'bball-game-set' the chosen set's games. Off: no read and both pages unchanged.
    'bball-game-logs': 'preview',
    // BB-G53: schedule context and rotation on /<league>/team/[id], inside 'bball-team-season'. The schedule gains each game's
    // rest (back-to-back, third in four nights), road-trip position, opponent strength (team_strength) and closing line with
    // the ATS result (game_lines, where lines exist), plus the ATS and back-to-back records; a Rotation section adds a minutes
    // strip (players x games, starts marked) from player_box. Off: none of the three reads and the page unchanged.
    'bball-schedule-context': 'preview',
    // The game page's Impact box and Lineups used (BB-G1) on /<league>/game/[id] for a final, inside each league's flag:
    // each side's on-court minutes, possessions, +/- and ratings and its five most-used units (sdv-db's game_player_impact
    // and game_lineups_used, BB-D6). Names link to player pages: a pro's stats id is his page's id; college maps through
    // ncaa_player_crosswalk (BB-D37) and leaves a player with no pair unlinked. Off: no read and the game page is today's,
    // byte for byte.
    'bball-impact-box': 'preview',
    // BB-G28's Game flow: on /<league>/game/[id] for a final, the panel in football's drive-chart slot (a lead chart from
    // the play-by-play with its lead changes and 10-0 runs, and sdv-db's game_flow totals: time leading, runs, droughts,
    // stops, kills, game control). The season board is the leaderboards' Teams board (BB-G8). Off: no read and the game
    // page is today's.
    'bball-game-flow': 'preview',
    // BB-G26's EPV box: on /nba/game/[id] for a final from 2021-22 on, each side's EPV added with the ball and allowed and
    // each player's EPV added on their own events and on-court EPV +/- (sdv-db's epv_player_games / epv_team_games, BB-D24).
    // NBA only (no WNBA or college tables yet). Off: no read and the game page is today's, byte for byte.
    'bball-epv': 'preview',
    // BB-G18's pregame projection: on /<league>/game/[id] before tip, a Projection card (the favourite, the expected margin
    // and its win chance) read as published from the game's {lg}.rated_priors row (sdv-py#1193, sdv-db#229); no card when
    // the row is missing or its prediction is null. The bracketology bracket keeps its bid chances. Off: no read, and the
    // pregame page is today's, byte for byte.
    'bball-pregame-projection': 'preview',
    // BB-G2's garbage-time toggle on /<league>/game/[id] for a final, beside the Impact box (so only with 'bball-impact-box'
    // on too): `?garbage=out` re-shows the four factors, the pros' team box rows and the Impact box from the game's
    // possession log without the producer's garbage-time possessions (BB-D7's is_garbage_time; bigballR's in college).
    // No toggle when the log has no flag (a release from before BB-D7) or no garbage time. Off: no read, `?garbage=` is
    // ignored, and the game page is today's, byte for byte.
    'bball-garbage-time': 'preview',
    // BB-G40's play-by-play controls on /<league>/game/[id]: filters (event type, team, period, player, big WP swings only),
    // a points column and WPA beside home WP, and a sort toggle kept in `?order=` (newest first while live, oldest first
    // otherwise). Off: `?order=` is ignored and the plays table is today's, byte for byte.
    'bball-pbp-controls': 'preview',
    // BB-G35's Leaders panel on /<league>/game/[id], live or final: each side's leader by category (from the box), the
    // assist web (who assisted whom, from the play-by-play's assister on made shots; assisted and unassisted points by
    // zone) and, for a final, the players over and under their season scoring average (player_season_stats). Off: no
    // read, no panel, and the game page is today's, byte for byte.
    'bball-game-leaders': 'preview',
    // BB-G39's shooting signature and FG% distance bars beside each team's shot chart on /<league>/game/[id] for a final:
    // the game's shots by distance against the season's league curve (sdv-db's shot_league_context, BB-D1), linked to the
    // shot chart (hover or click a distance and the shots outside it fade). Off: no read and the game page is today's.
    'bball-game-shooting': 'preview',
    // BB-G38's shot filters on /<league>/game/[id], live or final: one bar over both teams' shot charts (team, player,
    // period, made/missed, zone, shot type, the pros' shot move, assisted/unassisted makes, and for a final with sdv-db's
    // game_stints, BB-D32, shots while a chosen player was on or off the floor), kept in the URL (`?shot_*=`), with the
    // filtered set's FG line; with 'bball-game-shooting' the signature and distance bars follow the team and shooter menus
    // only (a chosen player's whole game). Off: no read and the game page is today's, byte for byte.
    'bball-shot-filters': 'preview',
    // BB-G36's shift chart on a final's /<league>/game/[id]: a row per player, a bar per stint on the floor coloured by its
    // +/- with its clock, score and possessions on hover (sdv-db's game_stints, BB-D32); `?shift_on=<ESPN ids>` highlights a
    // unit and its shared minutes (BB-G37's link). Off: no read and the game page is today's.
    'bball-shift-chart': 'preview',
    // BB-G41's Latest strip on /<league>/game/[id] for a live game only (in progress, halftime, end of a period): the
    // last five plays newest first with their WP change, beside a half court drawing the last few located shots with
    // the older ones faded. No read: it is the page's own plays. Off, or a final: the game page is today's, byte for byte.
    'bball-latest-strip': 'preview',
    // BB-G32's team stats grid on /<league>/game/[id], live or final: the four factors and the team box in one panel, two
    // columns at lg; the better side tinted with the gap printed, sdv-py's counted possessions (BB-D31, the processor
    // only) beside the box estimate, each team's season rates under its game's (sdv-db team_season_rates, split all) and
    // the four-factor point accounting against that season's league average. Off: no read, the game page is today's,
    // byte for byte. `?garbage=out` keeps BB-G2's split tables.
    'bball-team-grid': 'preview',
    // BB-G33's possession factors on /<league>/game/[id], live or final: one panel of sdv-py's BB-D31 team splits for both
    // teams (situations with possessions, share and PPP; shot zones with corner vs above-the-break threes and eFG%; live vs
    // dead-ball turnovers and the points off each, shot mix, bench, leads, runs), the better side tinted. The splits come with
    // the processor payload, so no read; a Data API final has no splits until {lg}.game_team_splits is published. BB-D40's
    // expected points (situation and zone points over expected, zone xPPP, expected TS% and DRtg) come with the processor
    // payload too (priced against the league's shot cells, python/shot_cells.py); a Data API final reads one
    // {lg}.game_team_expected row a team. A season not built, or no cells, hides the expected columns with a note. Off: no
    // read, the game page is today's, byte for byte. Hidden beside `?garbage=out`.
    'bball-situational-box': 'preview',
    // BB-G34's player box views on /<league>/game/[id], live or final: Basic / Advanced / Shooting / Vs average, each cell
    // shaded against everyone who played. Advanced's possession columns and Shooting come from sdv-py's BB-D31 player
    // splits (the processor only); Vs average reads sdv-db player_season_stats. Also the box's visual fixes (no wrapped
    // made-attempted cells, a visible bench rule, short names on phones, the teams stacked rather than overflowing two
    // up). Off: no read, the game page is today's, byte for byte.
    'bball-player-box-views': 'preview',
    // BB-G37's in-game lineups inside the game page's Impact box (so only with 'bball-impact-box' on too): every 1- to 5-man
    // unit with a size selector and a small-sample toggle, each player's on/off, and an on/off picker that splits the game by
    // up to five players on or off (sdv-db game_units / game_on_off, BB-D32). Off: no read and the Impact box is BB-G1's.
    'bball-ingame-lineups': 'preview',
    // BB-G26's EPV box: on /<league>/game/[id] for a final from 2021-22 on, each side's EPV added with the ball and allowed
    // and each player's EPV added on their own events and on-court EPV +/- (sdv-db's epv_player_games / epv_team_games,
    // BB-D24). All four leagues (BB-G46 added the WNBA and college). Off: no read and the game page is today's, byte for byte.
    'bball-epv': 'preview',
    // BB-G42's Game info on /<league>/game/[id], pregame, live and final: the officiating crew with each official's season
    // profile (official_seasons, BB-D34) against the league's games-weighted average, and availability: the pros' injury
    // report (ESPN's, pregame and live; the day's espn_injuries snapshot for a final) and the box's DNPs with their reasons.
    // Off: no read, and the pregame and game pages are today's.
    'bball-game-info': 'preview',
    // BB-G44's player props panel on /<league>/game/[id] for a final or live nba/wnba/mbb game (women's college has no
    // props upstream: no read, no panel): each player's closing line per stat with the no-vig over probability (sdv-db's
    // player_props, BB-D33), beside the box score's count, O / U after the final and progress toward the line live. No
    // panel when the game has no matched lines. Off: no read and the game page is today's, byte for byte.
    'bball-props': 'preview',
    // The head-coach boards for both leagues: /year/N/coaches/*, /coaches/* and
    // their /nfl twins, the header's Head Coaches section and the sitemap's
    // coach URLs. Gated in middleware exactly like 'nfl' (utils/coaches.ts
    // isCoachBoardPath). Promote to 'on' once the coach attribution is trusted.
    'coaches': 'on',
    // The About page (/about): who builds the site, with each person's bio. Stays in preview
    // until all three bios are in; promote to 'on' to publish the URL and the footer link.
    'about-page': 'preview',
    // The CFP projection page (/playoff): sportsdataverse-py's season sims + cfbseedR tiebreakers
    // through the API (python/playoff_projection.py), the 2026 selection rules and the fixed
    // bracket, plus the committee's field from the CFP rankings. Public since #389: linked
    // under the header's Tools menu and listed in the sitemap.
    'playoff-projection': 'on',
    // The play processor's source switch (football-sources Stage 4): the game
    // page may ask the API to process a game from an alternate feed
    // (?source=shield|cbs|yahoo|fox|ncaa, the sportsdataverse-py contract's
    // registry) and renders from the API's own header when ESPN's cdn is down.
    // Nothing public changes while this is 'preview': only this path sends
    // `?source=` to the API, so the request, its cache key and the response are
    // exactly what they are today for every other viewer. Promote to 'on' once
    // an alternate adapter is trusted end to end. The basketball game pages
    // (nba/wnba/mbb/wbb, routes/basketball/game.ts) take the same `?source=`
    // under the same flag and admin session, with no header fallback.
    'source-switch': 'preview',
    // Individual player pages: /players/<espn id> and the /nfl twin, plus the
    // hrefs the leaderboard rows and the game-page usage box grow to reach them.
    // Gated in middleware exactly like 'nfl' and 'coaches' (utils/players.ts
    // isPlayerPath); the links are gated in their components, because a public
    // link into a 404 namespace is worse than no link. Promote to 'on' once the
    // player-keyed Data API routes are live and the sitemap block is filled in.
    'player-pages': 'on',
    // Game-page header links: the team names in the h1 go to /team/<id>, and the
    // Back button goes to the game's own week. Links on text the page already
    // shows, no new element. Read in GameHeader.astro, which both game-page
    // twins and the pregame page import.
    'game-links': 'on',
    // One team-colour decision per game (utils/misc.ts pickGameColors), a pair
    // per theme, handed to every chart on the game page (WP, EP, drive charts,
    // Deserved Win %) and the matchup radar. Off: each chart keeps its own
    // legacy colours.
    'game-colours': 'on',
    // The Five Factors panel on the season team page (/year/N/team/<id> and the
    // /nfl twin), under Profile. Only this path adds the factor columns to the
    // team_summaries `select`, so for every other viewer the request, its cache
    // key and the page are exactly what they are today. Promote to 'on' once the
    // table has been reviewed on production data.
    'five-factors': 'on',
    // The header search box (components/search/SiteSearch.svelte) and the
    // GET /api/search proxy it calls, which 404s for every other viewer. Hits
    // into a gated namespace are dropped per viewer: players while
    // 'player-pages' is off, NFL rows while 'nfl' is off. Prerendered pages
    // (glossary, changelog) resolve the flag at build time, so
    // they show no box while this is 'preview'.
    'site-search': 'on',
    // The data-status table in /data-sources' Freshness section: when each season surface
    // last refreshed (its table's /v1/meta stamp, the one that stamps and keys the surface
    // itself; utils/freshness.ts STATUS_SURFACES), plus one "Live from ESPN" row. The page is
    // SSR for this (5 min edge cache); off, its HTML is unchanged and it reads nothing.
    'data-status': 'preview',

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
    'rank-neighbors': 'on',
    // The Situational Splits panel on the season team page (/year/N/team/<id> and
    // the /nfl twin): the team's team_tendencies row by down, field, score and
    // game context, for offense or defense, ranked against the season's other
    // rows. Only this path reads team_tendencies there; for every other viewer
    // the page and its requests are unchanged.
    'team-splits': 'on',
    // Results by Opponent on the season team page (/year/N/team/<id> and the
    // /nfl twin): one bar per game from team_opponent_splits, EPA and Success %
    // per play, dropback and rush, raw or margin, with a dashed season average. Only this path
    // reads team_opponent_splits; every other viewer's requests are unchanged.
    'vs-opponent': 'on',
    // Chart Builder v2 on /charts/builder (both leagues): one control bar (Season, X, Y, Random axes,
    // Plot) above the chart, and a median crosshair with quadrant labels. Off: today's builder.
    'chart-builder-v2': 'on',
    // The Record panel on the season team page (/year/N/team/<id> and the /nfl
    // twin): the team's record split by home/away/neutral, conference (division
    // in the NFL), one-score games, vs FBS and vs ranked. It pivots the schedule
    // rows the page already reads for the TeamCard, so no request changes.
    // Promote to 'on' once the table has been reviewed on production data.
    'team-record-splits': 'on',
    // The team profile's Metric History (/team/<id> and the /nfl twin) draws its boxes from the national
    // distribution of team SEASONS (sdv-db `team_summaries/percentiles`, one read) instead of the team-GAME
    // ladder, and Net Statistics get boxes too. National Trends (/charts/trends and the /nfl twin) draws the same
    // distribution for the metrics team_summaries carries; its other metrics, and either page when the read
    // fails, keep the game ladder. Off: the ladder reads and today's charts, unchanged. Game pages keep the ladder.
    'team-season-bands': 'on',
    // The team profile as a history hub (/team/<id> and the /nfl twin): Best Seasons, Head Coaches and,
    // CFB only, Conference History tables under Seasons. Only this path reads the team's
    // coach_tendencies rows; the other two pivot the team_summaries rows the page already reads.
    'team-hub': 'preview',
    // The metric registry (roadmap F13; resources/metricRegistry.ts, generated from sdv-py) on the chart builder
    // (/charts/builder and the /nfl twin): axis and select titles take the registry's label first (Rushes/Drive,
    // Off Pass Rate, ...) and start_position flips as lower-is-better, as the producer ranks it. Off: today's
    // titles and flips, byte for byte (test/metricTitles.test.ts holds them to a fixture cut from main).
    'metric-registry': 'preview',
    // The Team Stats panel on the season team page (/year/N/team/<id> and the /nfl twin): the team's
    // EPA/Play, Success Rate and points over a subset of its games (?games=conf|nofcs|home|away|wins|
    // losses|last4), ranked against the same subset of every FBS (NFL) team's games, or the conference's
    // for conference games. Only this path makes the season-wide team_opponent_splits read; off, the
    // page and its requests are unchanged and ?games= is never read.
    'game-set-filter': 'preview',
    // The Situations head-coach board (/coaches/situations, /year/N/coaches/situations and the /nfl
    // twins, inside the 'coaches' gate): games and win rate after a bye, in openers, in one-score
    // games and (CFB) vs ranked, from coach_tendencies / coach_careers. Off: the board select does
    // not list it, its routes 404 and the sitemap leaves it out (utils/coaches.ts coachBoardSlugs).
    'coach-situations': 'preview',
    // Stat-threshold search (S15): /search/seasons and the /nfl twin, player-seasons at or above every
    // threshold from sdv-db's player_seasons_wide. Gated in middleware (utils/statSearch.ts isStatSearchPath);
    // the header's Tools entry reads the same flag. Not in the sitemap.
    'stat-search': 'preview',
    // IF-6: on a final game, GameHeader shows "First <W>-<L> final (<span>)" when no earlier
    // completed game in the Data API schedule table ended with that score (CFB: FBS vs FBS
    // since 2001; NFL: since 1999). utils/finalScore.ts. Off: no read, the header is unchanged.
    'final-score-first': 'preview',
    // G9: each team's player section on the v2 game page gets the Team Stats "Show only"
    // select (Game, quarters, halves, OT when played), each window pre-rendered from
    // advBoxScoreSpans (game/metrics/TeamPlayerStats.astro). Off: the section is unchanged.
    'player-quarter-filter': 'preview',
    // Method notes (IF-3): every advanced panel says its population in one voice (utils/methodNotes.ts). The
    // season team page's player tables and Profile panel carry the season note; the game page's Team Stats title
    // carries the game note as a hover. Off: today's hand-typed subtitles. Promote once the copy is reviewed.
    'method-notes': 'preview',
    // Player compare: /players/compare?ids=a,b&season=N and the /nfl twin, up to four player cards
    // side by side, plus the Compare button on the player page's header card. Off: the page is
    // the site's 404 and the player page has no button.
    'player-compare': 'preview',
    // Metric help on tap (N6): a "?" button beside a leaderboard column header opens that metric's glossary
    // definition in a native popover (utils/metricHelp.ts), linked to its /glossary/ anchor. Works on touch,
    // where the <abbr title> hover never shows. Off: the headers are exactly today's. Promote once reviewed.
    'metric-help': 'preview',
    // Game on Paper Pro: /pro/** (the paid player profiles, portal board and their
    // files), /pricing, the "Pro profile" link on the free player page and the
    // header's Pro entry. Gated in middleware like 'nfl': without the preview cookie
    // every one of those paths is the site's 404. Behind the flag, /pro/** also
    // needs a live entitlement (utils/pro.ts, resources/pro.ts) except login,
    // auth, logout and methodology. Promote to 'on' at launch.
    'pro': 'preview',
    // The team page's lineup shot chart (BB-G52) on /<league>/team/[id], inside each league's flag: the team's offense or
    // defense season shots with up to five of its players on or off the floor, by square or zone against the league (sdv-db's
    // shot_lineups, filtered in the route). Off: no read and the team page is today's, byte for byte.
    'bball-lineup-shotchart': 'preview',
    // The NBA Cup (BB-G30): /nba/cup inside 'nba', linked from /nba/standings and, in the Cup window (November and
    // December, utils/nbaCup.ts isCupWindow), from the NBA Header. sdv-db's daily Cup
    // snapshots (cup_standings, cup_sims): the six groups in the Cup's tiebreak order, the wild-card race, the knockout
    // on the CFP page's bracket component and the odds to advance and win. Off: the page is the site's 404, and the
    // standings page and the Header have no link.
    'bball-nba-cup': 'preview',
    // Rolling leaders' improvers and decliners (BB-G11): a "Most declined" board beside "Most improved" on /<league>/leaders
    // (nba, wnba, mbb, wbb), the same change (window eFG% minus the season eFG%) ranked from the largest drop, and the
    // change's definition on the page. Off: the boards, the island's props and the page are today's.
    'bball-rolling-movers': 'preview',
    // Nearby ranks on the basketball team pages (BB-G12, football's 'rank-neighbors'), inside each league's flag: for each
    // of twelve measures, the teams ranked within five places, the page's own row marked, by team_strength's ranks (all four
    // leagues). Player lists wait for a producer-ranked player table with a minimum. Off: no read, the page is today's.
    'bball-rank-neighbors': 'preview',
    // Head-coach boards (BB-G9): /nba/coaches and /wnba/coaches and their Header entry, inside each league's flag.
    // Football's coach boards on sdv-db's coach_seasons / coach_careers: Career or a season, Ratings or Four Factors,
    // the producer's ranks and percentiles, with the partial-coverage notice. College waits on an NCAA coach release.
    // Off: the pages are the site's 404 and the Header is today's.
    'bball-coaches': 'preview',
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
 * public-facing surface (the Header's Tools menu) for them. The football Header's league switch asks
 * Astro.locals.preview itself, so a preview viewer sees the preview leagues there (BB-G31).
 */
export function isFeaturePublic(name: string, locals: { flagOverrides?: Record<string, boolean> } | undefined): boolean {
    const override = locals?.flagOverrides?.[name];
    return override !== undefined ? override : FLAGS[name] === 'on';
}
