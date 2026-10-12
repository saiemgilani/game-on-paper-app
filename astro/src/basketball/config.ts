// The per-league basketball config: everything the basketball pages need that differs between the NBA, the WNBA and
// men's and women's college basketball. One entry per BASKETBALL_LEAGUES slug (the Record type refuses a missing one).
// Leaf data (team lists, court geometry, dark-logo lists) stays in src/nba/**; this file only points at it.
import { leagueSource, NBA_GAMES_SOURCE, isBasketball, type BasketballLeague, type League, type SdvSource } from '../utils/league';
import { COURT } from '../nba/data/court';
import { NETS_TEAM_ID, TEAMS, teamByEspnId, type Team } from '../nba/data/teams';
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
export type DarkLogoStrategy = { kind: 'abbr'; logoLeague: string; abbrs: ReadonlySet<string> } | { kind: 'id'; logoLeague: string } | { kind: 'none' };
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
 * `format.regulation.periods`) and wins when it is 2 or 4; anything else falls back to the era `season` is in.
 */
export function pickRegulation(eras: readonly RegulationEra[], season: number | null | undefined, dataPeriods?: unknown): Regulation {
    const s = season == null ? NaN : Number(season);
    const byYear = [...eras].reverse().find((e) => Number.isNaN(s) || s >= e.from) ?? eras[0];
    const n = dataPeriods == null || dataPeriods === '' ? NaN : Number(dataPeriods);
    if (!(n === 2 || n === 4) || n === byYear.periods) return plain(byYear);
    const same = [...eras].reverse().find((e) => e.periods === n);
    // ponytail: no era of that shape in this league (data and config disagree): keep the era's regulation minutes
    return same ? plain(same) : { periods: n, kind: n === 2 ? 'half' : 'quarter', periodMinutes: (byYear.periods * byYear.periodMinutes) / n };
}

export function regulationFor(league: BasketballLeague, season: number | null | undefined, dataPeriods?: unknown): Regulation {
    return pickRegulation(BASKETBALL[league].regulation, season, dataPeriods);
}

export function courtFor(league: BasketballLeague, season: number | null | undefined): Court {
    const eras = BASKETBALL[league].courts;
    const s = season == null ? NaN : Number(season);
    return ([...eras].reverse().find((e) => Number.isNaN(s) || s >= e.from) ?? eras[0]).court;
}

/** '2025-26' (span) or '2025' (year) for a season's END year. */
export function seasonLabelFor(league: BasketballLeague, endYear: number): string {
    return BASKETBALL[league].seasonLabelStyle === 'span' ? seasonLabel(endYear) : String(endYear);
}
