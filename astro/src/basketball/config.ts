// The per-league basketball config: everything the basketball pages need that differs between the NBA, the WNBA and
// men's and women's college basketball. One entry per BASKETBALL_LEAGUES slug (the Record type refuses a missing one).
// Leaf data (team lists, court geometry, dark-logo lists) stays in src/nba/**; this file only points at it.
import { LEAGUES, leagueSource, NBA_GAMES_SOURCE, WNBA_LOGO_ABBR, isBasketball, type BasketballLeague, type League, type SdvSource } from '../utils/league';
import { COURT, NCAA_COURTS, WNBA_COURT, WNBA_COURT_1997, WNBA_COURT_2004, WNBA_RESTRICTED_AREA } from '../nba/data/court';
import { MBB_MEMBERS_2026 } from '../nba/data/mbbMembers';
import { MBB_MEMBER_SEASONS, MBB_MEMBER_SEASONS_THROUGH } from '../nba/data/mbbMemberSeasons';
import { MBB_CONFERENCES, MBB_TEAMS, mbbFranchiseOf, mbbSeasonsOf, mbbTeamByEspnId, mbbTeamInSeason } from '../nba/data/mbbTeams';
import { placeholderAt, type PlaceholderLocation } from '../nba/data/placeholder';
import { NETS_TEAM_ID, TEAMS, franchiseOf, teamByEspnId, teamById, teamInSeason, type Team } from '../nba/data/teams';
import { WNBA_TEAMS, wnbaFranchiseOf, wnbaLogoId, wnbaSeasonsOf, wnbaTeamByEspnId, wnbaTeamInSeason } from '../nba/data/wnbaTeams';
import { NBA_LEADER_BARS, type LeaderBars, type LeaderWindow } from '../nba/data/leaders';
import { RANK_MIN, type RankMins } from '../nba/data/ranks';
import { mbbGamesInScope, mbbLeaderBars, mbbSeasonGames, netsTricode, wnbaLeaderBars, wnbaSeasonGames } from '../nba/seasonRange';
import { seasonLabel } from '../nba/seasons';
import { NBA_DARK_LOGO_ABBRS } from '../nba/scoreboard';

export type PeriodKind = 'quarter' | 'half';
/** A rule from season `from` (END year: 2016 is 2015-16; a WNBA season is its year) until the next era. */
export interface RegulationEra { from: number; periods: 2 | 4; kind: PeriodKind; periodMinutes: number }
export interface Regulation { periods: number; kind: PeriodKind; periodMinutes: number }
export type Court = { readonly [K in keyof typeof COURT]: number };
export interface CourtEra { from: number; court: Court }
export type SeasonLabelStyle = 'span' | 'year';
export type Pronoun = 'his' | 'her';
export type DarkLogoStrategy =
    | { kind: 'abbr'; logoLeague: string; abbrs: ReadonlySet<string> }
    | { kind: 'id'; logoLeague: string }
    // D22: the board's ESPN team id -> today's logo abbreviation, so an old board's WAS / TUL / NYL still gets a dark logo
    // `logoId` re-keys an id by season first (wnbaLogoId: the 2000-02 Portland Fire under the 2026 Fire's 132052)
    | { kind: 'idKeyed'; logoLeague: string; abbrById: Readonly<Record<string, string>>; logoId?: (espnId: string, season?: number | null) => string }
    | { kind: 'none' };
export interface FeaturedTeam { statsTeamId: number; espnTeamId: number; menuLabel: string; tricode(season: number): string }
export type LandingKind = 'featured-team' | 'teams-index';
export type ShotDashboardsSource = 'stats-api' | 'ncaa' | 'none';
export interface MenuItem { label: string; path: string }
/** One scoreboard group: ESPN's cdn `group=<id>` and the selector's label. */
export interface ScoreboardGroup { id: string; label: string }
/** A league with more games a day than one board shows (college): ESPN's no-group board is `default`, `all` its every-team group. */
export interface ScoreboardGroups { default: 'top25'; all: string; conferences: readonly ScoreboardGroup[] }
export interface TeamModule {
    all: readonly Team[];
    byEspnId(espnId: number): Team | undefined;
    /** the team as it was that season; undefined = unknown id */
    inSeason(teamId: number, season: number): Team | undefined;
    /** a current franchise's team id for any tricode it has used */
    franchiseOf(tricode: string): number | undefined;
    /** the seasons of the franchise holding `teamId` in `season` (the season pickers' options); undefined = unknown id */
    seasonsOf(teamId: number, season: number): readonly number[] | undefined;
}

export interface BasketballConfig {
    league: BasketballLeague;
    /** the ESPN-keyed schema the game page reads (schedule, pbp, team_box, player_box, play_wp, game_*_rates) */
    gamesSource: SdvSource;
    /** stats.nba.com / stats.wnba.com LeagueID; null for college */
    statsLeagueId: '00' | '10' | null;
    /** regular-season game ids in the shots table start with this ('002'); null = no filter */
    regularGameIdPrefix: string | null;
    /** the shot data's provider as page copy ('stats.nba.com'); null when the league has no shot dashboards */
    statsSourceLabel: string | null;
    /** ascending `from`; used only when a game carries no regulation of its own */
    regulation: readonly RegulationEra[];
    overtimeMinutes: number;
    seasonLabelStyle: SeasonLabelStyle;
    /** the earliest ?date= the scoreboard accepts (ISO day) */
    firstScoreboardDay: string;
    /** the zone whose calendar day a game belongs to on the scoreboard */
    scoreboardTimeZone: string;
    /** seconds; the live scoreboard and a live game page refresh at this rate all year */
    scoreboardRefresh: number;
    darkLogo: DarkLogoStrategy;
    /** D21/D37: the WP panel's model sentence, only what sdv-py records; trusted config, rendered unescaped */
    wpModelNote: string;
    featuredTeam: FeaturedTeam | null;
    /** ascending `from` */
    courts: readonly CourtEra[];
    teams: TeamModule;
    landing: LandingKind;
    /** the Header's basketball entries, paths relative to the league prefix */
    headerMenu: readonly MenuItem[];
    shotDashboards: ShotDashboardsSource;
    /** regular-season games per team in a season: the scale of the season-total thresholds (rankMins) */
    regularSeasonGames(season: number): number;
    /** the players' pronoun in chart copy ("her season FG%") */
    pronoun: Pronoun;
    /** D31: the rolling leaders' per-game bars in a season (the NBA's 5 FGA / 3 3PA, scaled by game volume) */
    leaderBars(season: number): LeaderBars;
    /** D29: the provider's placeholder shot location, left out of the location charts and counted; unset = every shot is located */
    placeholderLocation?: PlaceholderLocation;
    /** absent: one board a day (NBA, WNBA). Present: ?group=top25|all|<conference id> (spec D3, Task 6) */
    scoreboardGroups?: ScoreboardGroups;
    /** ESPN's college feeds put field goals they did not locate at the rim, (25, 0); the game shot chart drops the impossible ones (Task 4) */
    espnRimPlaceholder?: boolean;
    /**
     * Owner ruling D44 (R6): the season's games in scope (regular season + postseason) for leagues whose dashboards include the
     * postseason (college, D23). Absent: thresholds keep regularSeasonGames (NBA, WNBA). Plan #9 makes rankMins read it.
     */
    gamesInScope?: (season: number) => number;
    /**
     * Owner rulings D33/D39 (R12): the first season (END year) ESPN publishes betting lines for the league, measured (Task 5 Step 0).
     * From it on, an ingested final without a line says the line is not in the warehouse; absent: "No line" everywhere (NBA, WNBA).
     */
    linesFromSeason?: number;
    /** Owner ruling D36 (R11): 'status' renders a day's cards in Live / Upcoming / Final sections with jump links (college). Absent: one grid. */
    scoreboardGrouping?: 'status';
    /** The shot dashboards' first season when it is later than the league's first listed season (stats.ncaa.org charts from 2019). */
    shotFirstSeason?: number;
    /** D25: the source has no PIE (college box scores), so its column, header item and sort key are hidden. */
    hidePie?: true;
    /**
     * D26: the leaders page reads only the last `days` days of player games (a season-wide read is over the API's 50,000-row cap)
     * and offers these windows. `days` counts inclusive dates (R-P4): the read is [latest - (days - 1), latest], so 49 is the
     * latest game date and the 48 before it; never subtract `days` itself.
     */
    leadersRead?: { days: number; windows: readonly LeaderWindow[] };
    /** D43/D47: the current season's members (a committed table), for the sitemap and current-season team links, which make no API read. */
    currentMembers?: { season: number; ids: readonly number[] };
    /** R-P11: each team's member seasons through `through` (a generated table), for the season pickers; seasons after it are unknown. */
    memberSeasons?: { through: number; seasons: ReadonlyMap<number, readonly number[]> };
}

export const BASKETBALL: Record<BasketballLeague, BasketballConfig> = {
    nba: {
        league: 'nba',
        gamesSource: NBA_GAMES_SOURCE,
        statsLeagueId: '00',
        regularGameIdPrefix: '002',
        statsSourceLabel: 'stats.nba.com',
        regulation: [{ from: 0, periods: 4, kind: 'quarter', periodMinutes: 12 }],
        overtimeMinutes: 5,
        seasonLabelStyle: 'span',
        firstScoreboardDay: '1997-10-01',
        scoreboardTimeZone: 'America/New_York',
        // the NBA board refreshes every minute all year (utils/config.ts NBA_SCOREBOARD_REFRESH; a test pins they agree)
        scoreboardRefresh: 60,
        darkLogo: { kind: 'abbr', logoLeague: 'nba', abbrs: NBA_DARK_LOGO_ABBRS },
        wpModelNote: "Game on Paper's in-game model: score margin, time remaining, the pregame prior and possession.",
        featuredTeam: { statsTeamId: NETS_TEAM_ID, espnTeamId: 17, menuLabel: 'Nets', tricode: netsTricode },
        // court.ts draws the 1997-98-on line (seasonRange.ts: 1996-97's 22 ft line is not drawn, and is not listed)
        courts: [{ from: 1998, court: COURT }],
        // every NBA team id is in every listed season (the pickers list them all, as before)
        teams: { all: TEAMS, byEspnId: teamByEspnId, inSeason: teamInSeason, franchiseOf, seasonsOf: (id) => (teamById(id) ? LEAGUES.nba.seasons : undefined) },
        landing: 'featured-team',
        headerMenu: [
            { label: 'Scoreboard', path: '/scoreboard' }, { label: 'Nets', path: '/' }, { label: 'Players', path: '/players' },
            { label: 'Teams', path: '/teams' }, { label: 'Scatter', path: '/scatter' }, { label: 'Leaders', path: '/leaders' },
        ],
        shotDashboards: 'stats-api',
        regularSeasonGames: () => NBA_SEASON_GAMES,
        pronoun: 'his',
        leaderBars: () => NBA_LEADER_BARS,
    },
    wnba: {
        league: 'wnba',
        gamesSource: { apiBase: 'https://data.sportsdataverse.org/v1/wnba', schema: 'wnba', namespace: 'wnba-games' },
        statsLeagueId: '10',
        // stats.wnba.com regular-season game ids start 102 (playoffs 104): wnba_stats shots_2026, checked 2026-10-12
        regularGameIdPrefix: '102',
        statsSourceLabel: 'stats.wnba.com',
        // two 20-minute halves through 2005, four 10-minute quarters from 2006 (sdv-py nba_game_page _QUARTERS_FROM)
        regulation: [
            { from: 0, periods: 2, kind: 'half', periodMinutes: 20 },
            { from: 2006, periods: 4, kind: 'quarter', periodMinutes: 10 },
        ],
        overtimeMinutes: 5,
        seasonLabelStyle: 'year',
        // ESPN's cdn board has real finals from 2002-05-25; earlier days are TBD (1997) or frozen 'in progress' (1998-2001)
        firstScoreboardDay: '2002-05-25',
        scoreboardTimeZone: 'America/New_York',
        scoreboardRefresh: 60,
        // D22: keyed by ESPN id (ESPN serves WNBA logos only by abbreviation, and old boards spell WAS / TUL / NYL)
        darkLogo: { kind: 'idKeyed', logoLeague: 'wnba', abbrById: WNBA_LOGO_ABBR, logoId: wnbaLogoId },
        // D21/D37: only what sdv-py records (nba_prediction_constants.py: the artifact; the 2024 fit of the pregame home edge)
        wpModelNote: "Game on Paper's WNBA in-game model (sdv-py wnba_in_game_wp.ubj): score margin, time remaining, the pregame prior and possession. The pregame home edge was fitted on 220 of 264 2024 WNBA games.",
        featuredTeam: null,
        // plan #3 Task 5's eras (sdv-db WNBA_COURTS), split at the restricted-area adoption season it records (D32, R5)
        courts: splitAtRestrictedArea(
            [{ from: 1997, court: WNBA_COURT_1997 }, { from: 2004, court: WNBA_COURT_2004 }, { from: 2013, court: WNBA_COURT }],
            WNBA_RESTRICTED_AREA,
        ),
        teams: { all: WNBA_TEAMS, byEspnId: wnbaTeamByEspnId, inSeason: wnbaTeamInSeason, franchiseOf: wnbaFranchiseOf, seasonsOf: wnbaSeasonsOf },
        // pages/wnba/index.astro: the season's teams index with links to the scoreboard and the shooting pages
        landing: 'teams-index',
        // no featured-team entry (spec §3.4); /teams here is what turns on team links and sitemap team pages (hasTeamPages)
        headerMenu: [
            { label: 'Scoreboard', path: '/scoreboard' }, { label: 'Players', path: '/players' }, { label: 'Teams', path: '/teams' },
            { label: 'Scatter', path: '/scatter' }, { label: 'Leaders', path: '/leaders' },
        ],
        shotDashboards: 'stats-api',
        regularSeasonGames: wnbaSeasonGames,
        pronoun: 'her',
        leaderBars: wnbaLeaderBars,
        // D29 / R22: stats.wnba.com's hoop-centre placeholder, 1997-through only (sdv-db's located predicate, same bound)
        placeholderLocation: { x: 0, y: 0, through: 2010 },
    },
    mbb: {
        league: 'mbb',
        gamesSource: { apiBase: 'https://data.sportsdataverse.org/v1/mbb', schema: 'mbb', namespace: 'mbb-games' },
        statsLeagueId: null,
        regularGameIdPrefix: null,
        // the college shot dashboards' provider (plan #9); the game page's shot chart is ESPN's
        statsSourceLabel: 'stats.ncaa.org',
        // two 20-minute halves in every season (spec §3.1; every 2002-2026 schedule row has format_regulation_periods 2)
        regulation: [{ from: 0, periods: 2, kind: 'half', periodMinutes: 20 }],
        overtimeMinutes: 5,
        seasonLabelStyle: 'span',
        // ESPN's cdn board has finals from 2002-11-14; every earlier day of that autumn is empty
        firstScoreboardDay: '2002-11-14',
        scoreboardTimeZone: 'America/New_York',
        scoreboardRefresh: 60,
        // ncaa/500-dark/<espn id>.png is 200 for every D-I team (2026-10-18): the id is the key (D22), no abbreviation map
        darkLogo: { kind: 'id', logoLeague: 'ncaa' },
        // D21/D37 (R13): only what sdv-py records — the artifact (sportsdataverse/mbb/models/mbb_in_game_wp.ubj), the training
        // sentence (mbb_game_predict.py:122-124) and the five features of in_game_features (none of them the period)
        wpModelNote: "Game on Paper's men's college basketball in-game model (sdv-py mbb_in_game_wp.ubj, trained on the season before the pregame gate season; it does not use the period as a feature).",
        featuredTeam: null,
        courts: NCAA_COURTS,
        // seasonsOf keeps the TeamModule contract; the MBB season pickers read memberSeasonsOf (the member table) first
        teams: { all: MBB_TEAMS, byEspnId: mbbTeamByEspnId, inSeason: mbbTeamInSeason, franchiseOf: mbbFranchiseOf, seasonsOf: mbbSeasonsOf },
        // pages/mbb/index.astro: the season's teams by conference with links to the scoreboard and the shooting pages
        landing: 'teams-index',
        // no featured-team entry (spec §3.4); /teams here turns on team links and sitemap team pages (hasTeamPages)
        headerMenu: [
            { label: 'Scoreboard', path: '/scoreboard' }, { label: 'Players', path: '/players' }, { label: 'Teams', path: '/teams' },
            { label: 'Scatter', path: '/scatter' }, { label: 'Leaders', path: '/leaders' },
        ],
        shotDashboards: 'ncaa',
        regularSeasonGames: mbbSeasonGames,
        pronoun: 'his',
        // D31: 3 FGA / 2 3PA per game in the leaders' window (college teams take ~0.66 of an NBA team's FGA per game)
        leaderBars: mbbLeaderBars,
        // ESPN's cdn reads the singular `group=`: none = the Top 25 board, 50 = all of Division I (probe, Decision 1)
        scoreboardGroups: { default: 'top25', all: '50', conferences: MBB_CONFERENCES },
        espnRimPlaceholder: true,
        // sdv-py load_ncaa_mbb_shots floor: stats.ncaa.org shot charts exist from 2018-19 (the scoreboard keeps 2003-2026)
        shotFirstSeason: 2019,
        // D25: plan #7's season line is box-score based and its pie is NULL
        hidePie: true,
        // D26, measured (plans/2026-10-11-mbb-shots-gop.md, Measured facts; Task 2's leaders_window_rows.json): any 49-day window
        // of player games holds at most 43,835 rows (2022), under the 50,000 cap; a 20-game window needs ~120 days of games
        leadersRead: { days: 49, windows: [5, 10] },
        // the member table's last season; memberSeasons.test.ts ties it, these ids and MBB_LAST_KNOWN_SEASON together
        currentMembers: { season: MBB_MEMBER_SEASONS_THROUGH, ids: MBB_MEMBERS_2026 },
        memberSeasons: { through: MBB_MEMBER_SEASONS_THROUGH, seasons: MBB_MEMBER_SEASONS },
        // D44 (R6): regular season + postseason games, measured (games_in_scope.json); plan #9 wires rankMins / the scatter bar to it
        gamesInScope: mbbGamesInScope,
        // D39: hoopR-mbb-data has lined games in every season 2013-2023 and none before (lines_by_season.json); 2024-2026 lack
        // them in the release although ESPN has them (D33, the hoopR-mbb-data issue of Task 7)
        linesFromSeason: 2013,
        // D36: a full D-I day (199 games on 2024-11-04) is one page, sectioned by status (scoreboardBudget.test.ts holds its size)
        scoreboardGrouping: 'status',
    },
};

export function basketball(league: League | undefined | null): BasketballConfig {
    if (!isBasketball(league)) throw new Error(`not a basketball league: ${String(league)}`);
    return BASKETBALL[league];
}

/** The Data API schema behind the shot dashboards: the league's own LEAGUES source (nba_stats for the NBA). */
export function statsSourceOf(league: BasketballLeague): SdvSource | null {
    return BASKETBALL[league].shotDashboards === 'none' ? null : leagueSource(league);
}

const plain = (e: RegulationEra): Regulation => ({ periods: e.periods, kind: e.kind, periodMinutes: e.periodMinutes });

/**
 * A game's regulation. `dataPeriods` is the game's own count (schedule `format_regulation_periods`, ESPN
 * `format.regulation.periods`) and wins when the league has an era of that shape (WBB/WNBA halves vs quarters);
 * anything else -- junk, or a shape the league never played (an NBA "2") -- keeps the era `season` is in.
 */
export function pickRegulation(eras: readonly RegulationEra[], season: number | null | undefined, dataPeriods?: unknown): Regulation {
    const s = season == null ? NaN : Number(season);
    const byYear = [...eras].reverse().find((e) => Number.isNaN(s) || s >= e.from) ?? eras[0];
    const n = dataPeriods == null || dataPeriods === '' ? NaN : Number(dataPeriods);
    if (!(n === 2 || n === 4) || n === byYear.periods) return plain(byYear);
    const same = [...eras].reverse().find((e) => e.periods === n);
    if (!same) console.warn(`basketball: data says ${n} regulation periods, a shape this league never played; keeping ${byYear.periods}`);
    return plain(same ?? byYear);
}

export function regulationFor(league: BasketballLeague, season: number | null | undefined, dataPeriods?: unknown): Regulation {
    return pickRegulation(BASKETBALL[league].regulation, season, dataPeriods);
}

export function courtFor(league: BasketballLeague, season: number | null | undefined): Court {
    const eras = BASKETBALL[league].courts;
    const s = season == null ? NaN : Number(season);
    return ([...eras].reverse().find((e) => Number.isNaN(s) || s >= e.from) ?? eras[0]).court;
}

/** D29 / R22: the league's placeholder shot location in `season`, or null (after its `through`, or a league without one). */
export function placeholderFor(league: BasketballLeague, season: number): PlaceholderLocation | null {
    return placeholderAt(BASKETBALL[league].placeholderLocation, season);
}

/**
 * D32: a league's line eras split at the season it adopted the restricted-area arc. Before it the arc is neither drawn nor
 * zoned (restrictedRadius 0); from it, the recorded radius. A court that already carries that radius is kept as is, so an
 * era that starts after adoption keeps its own constant (courtFor(...) === WNBA_COURT).
 */
export function splitAtRestrictedArea(lines: readonly CourtEra[], ra: { readonly from: number; readonly radius: number }): CourtEra[] {
    const froms = [...new Set([...lines.map((e) => e.from), ra.from])].sort((a, b) => a - b);
    return froms.map((from) => {
        const line = lines.filter((e) => e.from <= from).slice(-1)[0].court;
        const restrictedRadius = from >= ra.from ? ra.radius : 0;
        return { from, court: line.restrictedRadius === restrictedRadius ? line : { ...line, restrictedRadius } };
    });
}

/** '2025-26' (span) or '2025' (year) for a season's END year. */
export function seasonLabelFor(league: BasketballLeague, endYear: number): string {
    return BASKETBALL[league].seasonLabelStyle === 'span' ? seasonLabel(endYear) : String(endYear);
}

/** A league has team pages exactly when its Header lists Teams; until then nothing links to /<league>/team/<id>. */
export function hasTeamPages(league: BasketballLeague): boolean {
    return BASKETBALL[league].headerMenu.some((m) => m.path === '/teams');
}

/**
 * D33/D39: the header's words for a game without a line. Only an ingested final (Data API) of a season ESPN publishes lines for
 * says "No line in the warehouse"; the processor reads ESPN's own summary, so its "No line" is ESPN's.
 */
export function noLineText(league: BasketballLeague, season: number | null, source: 'processor' | 'data_api'): 'No line' | 'No line in the warehouse' {
    const from = BASKETBALL[league].linesFromSeason;
    return from !== undefined && source === 'data_api' && season != null && season >= from ? 'No line in the warehouse' : 'No line';
}

/** The 82 games the shipped NBA bars (100 FGA, 50 3PA) were set for. */
export const NBA_SEASON_GAMES = 82;

/** A season's rank / scatter bars: the NBA's per-game rate over this league-season's games (the NBA: 100 / 50 always). */
export function rankMins(league: BasketballLeague, season: number): RankMins {
    // D44 (R6): a league whose dashboards include the postseason scales by its games in scope (plan #8's gamesInScope);
    // the NBA and WNBA have none, so their bars are unchanged
    const cfg = BASKETBALL[league];
    const g = (cfg.gamesInScope ?? cfg.regularSeasonGames)(season);
    return { fga: Math.round((RANK_MIN.fga * g) / NBA_SEASON_GAMES), fg3a: Math.round((RANK_MIN.fg3a * g) / NBA_SEASON_GAMES) };
}

export interface IslandLeagueProps { highlight?: string | null; minFga?: number; pronoun?: Pronoun; leaderBars?: LeaderBars }
/**
 * The league props the scatter, leaders and player islands take, minus every one equal to the island's own default (the
 * NBA's: 'Nets', 100, 'his', 5 / 3), so the NBA's serialized island props stay byte-identical (plan #4's islandPeriodProps rule).
 */
export function islandLeagueProps(league: BasketballLeague, season: number): IslandLeagueProps {
    const cfg = BASKETBALL[league];
    const highlight = cfg.featuredTeam?.menuLabel ?? null;
    const { fga } = rankMins(league, season);
    const bars = cfg.leaderBars(season);
    return {
        ...(highlight === 'Nets' ? {} : { highlight }),
        ...(fga === RANK_MIN.fga ? {} : { minFga: fga }),
        ...(cfg.pronoun === 'his' ? {} : { pronoun: cfg.pronoun }),
        ...(bars.fga === NBA_LEADER_BARS.fga && bars.fg3a === NBA_LEADER_BARS.fg3a ? {} : { leaderBars: bars }),
    };
}
