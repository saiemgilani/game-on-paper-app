// The per-league basketball config: everything the basketball pages need that differs between the NBA, the WNBA and
// men's and women's college basketball. One entry per BASKETBALL_LEAGUES slug (the Record type refuses a missing one).
// Leaf data (team lists, court geometry, dark-logo lists) stays in src/nba/**; this file only points at it.
import { leagueSource, NBA_GAMES_SOURCE, WNBA_LOGO_ABBR, isBasketball, type BasketballLeague, type League, type SdvSource } from '../utils/league';
import { COURT, WNBA_COURT, WNBA_COURT_1997, WNBA_COURT_2004, WNBA_RESTRICTED_AREA } from '../nba/data/court';
import { NETS_TEAM_ID, TEAMS, teamByEspnId, type Team } from '../nba/data/teams';
import { WNBA_TEAMS, wnbaLogoId, wnbaTeamByEspnId } from '../nba/data/wnbaTeams';
import { netsTricode } from '../nba/seasonRange';
import { seasonLabel } from '../nba/seasons';
import { NBA_DARK_LOGO_ABBRS } from '../nba/scoreboard';

export type PeriodKind = 'quarter' | 'half';
/** A rule from season `from` (END year: 2016 is 2015-16; a WNBA season is its year) until the next era. */
export interface RegulationEra { from: number; periods: 2 | 4; kind: PeriodKind; periodMinutes: number }
export interface Regulation { periods: number; kind: PeriodKind; periodMinutes: number }
export type Court = { readonly [K in keyof typeof COURT]: number };
export interface CourtEra { from: number; court: Court }
export type SeasonLabelStyle = 'span' | 'year';
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
export interface TeamModule { all: readonly Team[]; byEspnId(espnId: number): Team | undefined }

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
        teams: { all: TEAMS, byEspnId: teamByEspnId },
        landing: 'featured-team',
        headerMenu: [
            { label: 'Scoreboard', path: '/scoreboard' }, { label: 'Nets', path: '/' }, { label: 'Players', path: '/players' },
            { label: 'Teams', path: '/teams' }, { label: 'Scatter', path: '/scatter' }, { label: 'Leaders', path: '/leaders' },
        ],
        shotDashboards: 'stats-api',
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
        teams: { all: WNBA_TEAMS, byEspnId: wnbaTeamByEspnId },
        // plan #6 builds the teams index; until then pages/wnba/index.astro redirects to the scoreboard
        landing: 'teams-index',
        headerMenu: [{ label: 'Scoreboard', path: '/scoreboard' }],
        shotDashboards: 'stats-api',
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
