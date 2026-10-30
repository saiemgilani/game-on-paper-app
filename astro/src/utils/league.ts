import { AVAILABLE_SEASONS, CURRENT_YEAR } from './constants';
import { wnbaLogoId } from '../nba/data/wnbaTeams';
import { FIRST_SEASON as NBA_FIRST_SEASON, LAST_KNOWN_SEASON as NBA_LAST_KNOWN_SEASON, WNBA_FIRST_SEASON, WNBA_LAST_KNOWN_SEASON, MBB_FIRST_SEASON, MBB_LAST_KNOWN_SEASON, WBB_FIRST_SEASON, WBB_LAST_KNOWN_SEASON } from '../nba/seasonRange';

/**
 * The site renders one league per request. The NFL and the NBA live at explicit pages
 * under `pages/nfl/**` and `pages/nba/**` that set `Astro.locals.league` and render the
 * shared (football) or their own (basketball) route components; resources and link
 * builders read it. `cfb` is the
 * unprefixed default, so every pre-existing URL, cache key and KV key is
 * untouched.
 */
/** The basketball leagues, in the order their prefixes are tried. Adding a league starts here: the compiler then
 *  asks for its LEAGUES and BASKETBALL (basketball/config.ts) entries, and FLAGS needs a key with its slug. */
export const BASKETBALL_LEAGUES = ['nba', 'wnba', 'mbb', 'wbb'] as const;
export type BasketballLeague = (typeof BASKETBALL_LEAGUES)[number];
/** The professional leagues: their box scores carry plus-minus and a DNP reason; college box scores carry neither. */
export const PRO_LEAGUES: readonly BasketballLeague[] = ['nba', 'wnba'];
export type League = 'cfb' | 'nfl' | BasketballLeague;
export type Sport = 'football' | 'basketball';
export const DEFAULT_LEAGUE: League = 'cfb';
/** The leagues that live under a URL prefix, in the order `splitLeague` tries them. */
export const PREFIXED_LEAGUES: readonly Exclude<League, 'cfb'>[] = ['nfl', ...BASKETBALL_LEAGUES];

export interface LeagueConfig {
    slug: League;
    /** which family of pages and resources renders this league */
    sport: Sport;
    name: string;
    shortName: string;
    /** site URL prefix; '' for the default league */
    urlPrefix: '' | `/${Exclude<League, 'cfb'>}`;
    /** cdn.espn.com/core/<espnPath>/…, www.espn.com/<espnPath>/…, s.espncdn.com stitcher path */
    espnPath: 'college-football' | 'nfl' | 'nba' | 'wnba' | 'mens-college-basketball' | 'womens-college-basketball';
    /** sports.core.api.espn.com/v2/sports/football/leagues/<espnCoreLeague> */
    espnCoreLeague: 'college-football' | 'nfl' | 'nba' | 'wnba' | 'mens-college-basketball' | 'womens-college-basketball';
    /** extra query prepended on the cdn scoreboard call (cfb: FBS group + limit) */
    scoreboardQuery: string;
    /** cdn schedule `group` param; null = the league has no conference grouping */
    defaultGroup: number | null;
    /** KV key for the cached scoreboard; cfb keeps the historical bare key */
    scoreboardCacheKey: string;
    sdvApiBase: string;
    /** the Data API schema behind sdvApiBase; the `/v1/meta` ingest stamps are keyed `<schema>.<table>` */
    sdvSchema: string;
    /** SDV table holding the league's game schedule; the NFL's `schedule` is the
     *  nflverse frame, so its ESPN-shaped twin is published separately */
    scheduleTable: 'schedule' | 'espn_schedule';
    /** false until the league's season tables exist on the SDV API */
    sdvEnabled: boolean;
    seasons: number[];
    regularSeasonWeeks: number;
    postseasonWeeks: number;
    /** a.espncdn.com/i/teamlogos/<logoLeague>/500/<team id>.png */
    logoLeague: 'ncaa' | 'nfl' | 'nba' | 'wnba';
    /** teams ranked in a season table, when the season's own count (`teamCountOf`) is unknown */
    teamCount: number;
    /** the population the season tables describe, for copy ("FBS vs FBS games only") */
    pool: string;
    /** team-leaderboard categories beyond the shared differential/offensive/defensive */
    extraTeamCategories: string[];
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const LEAGUES: Record<League, LeagueConfig> = {
    cfb: {
        slug: 'cfb', sport: 'football', name: 'College Football', shortName: 'CFB', urlPrefix: '',
        espnPath: 'college-football', espnCoreLeague: 'college-football',
        scoreboardQuery: 'group=80&limit=1000&', defaultGroup: 80, scoreboardCacheKey: 'scoreboard',
        sdvApiBase: 'https://data.sportsdataverse.org/v1/cfb', sdvSchema: 'cfb', sdvEnabled: true, scheduleTable: 'schedule',
        // getters, not values: constants.ts -> misc.ts -> league.ts -> constants.ts is a
        // cycle, and an eager read here sees AVAILABLE_SEASONS before it is initialised
        get seasons() { return AVAILABLE_SEASONS; }, regularSeasonWeeks: 15, postseasonWeeks: 1,
        logoLeague: 'ncaa', teamCount: 134, pool: 'FBS', extraTeamCategories: [],
    },
    nfl: {
        slug: 'nfl', sport: 'football', name: 'NFL', shortName: 'NFL', urlPrefix: '/nfl',
        espnPath: 'nfl', espnCoreLeague: 'nfl',
        scoreboardQuery: '', defaultGroup: null, scoreboardCacheKey: 'scoreboard:nfl',
        sdvApiBase: 'https://data.sportsdataverse.org/v1/nfl', sdvSchema: 'nfl', sdvEnabled: true, scheduleTable: 'espn_schedule',
        // ESPN play-by-play for the NFL is reliable from the 2002 realignment on
        get seasons() { return range(2002, CURRENT_YEAR); }, regularSeasonWeeks: 18, postseasonWeeks: 5,
        logoLeague: 'nfl', teamCount: 32, pool: 'NFL',
        // the rbsdm.com measures the nfl-data producer adds to team_summaries
        extraTeamCategories: ['tendencies', 'fourth-downs', 'luck'],
    },
    nba: {
        slug: 'nba', sport: 'basketball', name: 'NBA', shortName: 'NBA', urlPrefix: '/nba',
        espnPath: 'nba', espnCoreLeague: 'nba',
        // no scoreboard, groups or weeks: the basketball pages read none of these
        scoreboardQuery: '', defaultGroup: null, scoreboardCacheKey: 'scoreboard:nba',
        // stats.nba.com-keyed tables (shots, player_game_logs, player_season_stats, shot_* derived);
        // ESPN-keyed nba.* is reached only inside the shot_season_players SQL
        sdvApiBase: 'https://data.sportsdataverse.org/v1/nba_stats', sdvSchema: 'nba_stats', sdvEnabled: true,
        scheduleTable: 'schedule',
        // END years: 1998 is 1997-98, the first season every shots file has the legacy frame
        get seasons() { return range(NBA_FIRST_SEASON, NBA_LAST_KNOWN_SEASON); },
        regularSeasonWeeks: 0, postseasonWeeks: 0,
        logoLeague: 'nba', teamCount: 30, pool: 'NBA', extraTeamCategories: [],
    },
    wnba: {
        slug: 'wnba', sport: 'basketball', name: 'WNBA', shortName: 'WNBA', urlPrefix: '/wnba',
        espnPath: 'wnba', espnCoreLeague: 'wnba',
        scoreboardQuery: '', defaultGroup: null, scoreboardCacheKey: 'scoreboard:wnba',
        // stats.wnba.com-keyed tables (shots, player_game_logs, shot_* derived: plan #6); the ESPN-keyed wnba.* game
        // tables are BASKETBALL.wnba.gamesSource
        sdvApiBase: 'https://data.sportsdataverse.org/v1/wnba_stats', sdvSchema: 'wnba_stats', sdvEnabled: true,
        scheduleTable: 'schedule',
        // a WNBA season is its calendar year
        get seasons() { return range(WNBA_FIRST_SEASON, WNBA_LAST_KNOWN_SEASON); },
        regularSeasonWeeks: 0, postseasonWeeks: 0,
        logoLeague: 'wnba', teamCount: 15, pool: 'WNBA', extraTeamCategories: [],
    },
    mbb: {
        slug: 'mbb', sport: 'basketball', name: "Men's College Basketball", shortName: 'MBB', urlPrefix: '/mbb',
        espnPath: 'mens-college-basketball', espnCoreLeague: 'mens-college-basketball',
        // the Top 25 / all-D-I / conference choice is BASKETBALL.mbb.scoreboardGroups (getScoreboardForDay's group option);
        // the football defaultGroup machinery (getRemoteGames, ScheduleDropdown) never sees a basketball league
        scoreboardQuery: '', defaultGroup: null, scoreboardCacheKey: 'scoreboard:mbb',
        // one schema for the ESPN-keyed game tables (BASKETBALL.mbb.gamesSource) and plans #7/#9's stats.ncaa.org shot tables
        sdvApiBase: 'https://data.sportsdataverse.org/v1/mbb', sdvSchema: 'mbb', sdvEnabled: true,
        scheduleTable: 'schedule',
        get seasons() { return range(MBB_FIRST_SEASON, MBB_LAST_KNOWN_SEASON); },
        regularSeasonWeeks: 0, postseasonWeeks: 0,
        // ESPN's core D-I list for 2026 (D34); a season's page list is plan #9's withSeasonMembers (D43/D47)
        logoLeague: 'ncaa', teamCount: 366, pool: 'D-I', extraTeamCategories: [],
    },
    wbb: {
        slug: 'wbb', sport: 'basketball', name: "Women's College Basketball", shortName: 'WBB', urlPrefix: '/wbb',
        espnPath: 'womens-college-basketball', espnCoreLeague: 'womens-college-basketball',
        // the Top 25 / all-D-I / conference choice is BASKETBALL.wbb.scoreboardGroups (getScoreboardForDay's group option)
        scoreboardQuery: '', defaultGroup: null, scoreboardCacheKey: 'scoreboard:wbb',
        // one schema for the ESPN-keyed game tables (BASKETBALL.wbb.gamesSource) and plans #7/#11's stats.ncaa.org shot tables
        sdvApiBase: 'https://data.sportsdataverse.org/v1/wbb', sdvSchema: 'wbb', sdvEnabled: true,
        scheduleTable: 'schedule',
        get seasons() { return range(WBB_FIRST_SEASON, WBB_LAST_KNOWN_SEASON); },
        regularSeasonWeeks: 0, postseasonWeeks: 0,
        // D38: ESPN's 357 core D-I programs + the six reclassifiers that played a full 2026 D-I schedule (WBB_OTHER_DI)
        logoLeague: 'ncaa', teamCount: 363, pool: 'D-I', extraTeamCategories: [],
    },
};

/** A league rendered by the basketball pages (routes/basketball, components/nba). */
export function isBasketball(league: League | undefined | null): league is BasketballLeague {
    return league != null && LEAGUES[league]?.sport === 'basketball';
}

/**
 * The n a season row's `_rank`s are out of: the season's own team count
 * (`team_count`, once the producer publishes it on the row), else the league default.
 * FBS has been 128 to 138 teams; a fixed 134 put ranks 135-138 below zero and
 * read the worst 2014 team as the 4th percentile (audit C3).
 */
export function teamCountOf(row: { team_count?: unknown } | null | undefined, league?: League): number {
    const n = Number(row?.team_count);
    return Number.isFinite(n) && n > 0 ? n : LEAGUES[league ?? DEFAULT_LEAGUE].teamCount;
}

/** A Data API schema to read from, when it is not the league's own (`nba` games vs `nba_stats` shooting). */
export interface SdvSource { apiBase: string; schema: string; /** cache-key prefix; '' keeps cfb's historical keys */ namespace: string }
export const NBA_GAMES_SOURCE: SdvSource = { apiBase: 'https://data.sportsdataverse.org/v1/nba', schema: 'nba', namespace: 'nba-games' };
export function leagueSource(league: League): SdvSource {
    return { apiBase: LEAGUES[league].sdvApiBase, schema: LEAGUES[league].sdvSchema, namespace: league === 'cfb' ? '' : league };
}

/** ESPN logo path segment for a league's team ids (numeric ids resolve for both). */
export function espnLogoLeague(league: League | undefined): LeagueConfig['logoLeague'] {
    return LEAGUES[league ?? DEFAULT_LEAGUE].logoLeague;
}

// ESPN serves NFL dark-mode logos only under the team ABBREVIATION: `nfl/500-dark/8.png`
// is a 404 while `nfl/500-dark/det.png` exists (CFB's `ncaa/500-dark/<id>.png` works).
// Charts that built the dark URL from the numeric id drew no logo for any NFL team in
// dark mode. ESPN team id -> logo abbreviation, all 32 verified against 500-dark on 2026-09-14.
export const NFL_LOGO_ABBR: Record<string, string> = {
    '1': 'atl', '2': 'buf', '3': 'chi', '4': 'cin', '5': 'cle', '6': 'dal', '7': 'den', '8': 'det',
    '9': 'gb', '10': 'ten', '11': 'ind', '12': 'kc', '13': 'lv', '14': 'lar', '15': 'mia', '16': 'min',
    '17': 'ne', '18': 'no', '19': 'nyg', '20': 'nyj', '21': 'phi', '22': 'ari', '23': 'pit', '24': 'lac',
    '25': 'sf', '26': 'sea', '27': 'tb', '28': 'wsh', '29': 'car', '30': 'jax', '33': 'bal', '34': 'hou',
};

// ESPN serves WNBA logos only under the abbreviation: `wnba/500-dark/<id>.png` is a 404 for all 15 teams and `wnba/500/<id>.png`
// for Golden State (129689), Toronto (131935) and Portland (132052). ESPN team id -> abbreviation, all 15 verified 2026-10-12
// (re-probed 2026-10-18) against both 500 and 500-dark. Of the defunct franchises, ESPN serves Charlotte (1, cha), Houston (4, hou)
// and Sacramento (13, sac) by abbreviation (probe 2026-10-18); Cleveland (2), Miami (7) and the 2000-02 Portland Fire (12, not
// the 2026 Fire's `por`) have no ESPN logo, so the site hosts theirs (WNBA_HOSTED_LOGOS).
// The non-numeric keys are relocation eras (WNBA_FORMER_NAMES `logo`, via wnbaLogoId): ESPN still serves the Detroit Shock,
// Tulsa Shock, San Antonio Silver Stars and San Antonio Stars marks under both 500 and 500-dark (probe 2026-10-18).
export const WNBA_LOGO_ABBR: Record<string, string> = {
    '20': 'atl', '19': 'chi', '18': 'con', '3': 'dal', '129689': 'gs', '5': 'ind', '17': 'lv', '6': 'la',
    '8': 'min', '9': 'ny', '11': 'phx', '132052': 'por', '14': 'sea', '131935': 'tor', '16': 'wsh',
    '1': 'cha', '4': 'hou', '13': 'sac',
    det: 'det', tul: 'tul', sas: 'sas', sa: 'sa',
};

// WNBA logos the site serves itself, keyed by wnbaLogoId: defunct franchises' (by ESPN id) and the Utah Starzz and Orlando
// Miracle eras ESPN has none for (by era key). WNBA.com's own 2002 files, as archived by the Wayback Machine (source, dates
// and sha256 in public/assets/img/wnba/README.md). One file serves light and dark, so no dark rule may replace one.
export const WNBA_HOSTED_LOGOS: Record<string, string> = {
    '2': '/assets/img/wnba/cle.png', '7': '/assets/img/wnba/mia.png', '12': '/assets/img/wnba/por-2000.png',
    uta: '/assets/img/wnba/uta.png', orl: '/assets/img/wnba/orl.png',
};

/**
 * ESPN logo URL for a team, light or dark. Dark NFL logos go through the abbreviation
 * path; an NFL id missing from the map falls back to the light logo rather than a 404.
 * A WNBA team's logo is keyed by wnbaLogoId(id, season), which picks a relocated franchise's era logo: a site-hosted file
 * ESPN has none for (a root-relative path), else ESPN's by abbreviation (WNBA_LOGO_ABBR), else ESPN's default shield.
 * `season` only matters there.
 */
export function teamLogoUrl(league: League | undefined, teamId: string | number, dark: boolean, season?: number | null): string {
    const logoLeague = espnLogoLeague(league);
    const id = String(teamId);
    const light = `https://a.espncdn.com/i/teamlogos/${logoLeague}/500/${id}.png`;
    if (logoLeague === 'wnba') {
        const key = wnbaLogoId(id, season);
        return WNBA_HOSTED_LOGOS[key] ?? (WNBA_LOGO_ABBR[key]
            ? `https://a.espncdn.com/i/teamlogos/wnba/${dark ? '500-dark' : '500'}/${WNBA_LOGO_ABBR[key]}.png`
            : 'https://a.espncdn.com/i/teamlogos/default-team-logo-500.png'); // ESPN serves no WNBA logo by id
    }
    if (!dark) return light;
    if (logoLeague === 'nfl') {
        const abbr = NFL_LOGO_ABBR[id];
        return abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbr}.png` : light;
    }
    return `https://a.espncdn.com/i/teamlogos/${logoLeague}/500-dark/${id}.png`;
}

// `nfl.espn_schedule` carries nflverse week numbering, where the postseason
// CONTINUES the regular-season count instead of restarting at 1 -- so a game in
// week 22 is the Super Bowl, and "Week 22" would mean nothing to a reader.
// The count it continues FROM moved when the regular season went to 17 games:
// week 19 is the Divisional round in 2019 and the Wild Card round in 2021, so
// the round is the week minus that season's regular-season length, never the
// week alone. Both `nfl.schedule` and `nfl.espn_schedule` show exactly two eras
// and no exceptions: 1999-2020 regular 1-17 / postseason 18-21, 2021 onwards
// regular 1-18 / postseason 19-22.
export const NFL_SEVENTEEN_GAME_SEASON = 2021;
const NFL_POSTSEASON_ROUNDS = ['Wild Card', 'Divisional', 'Conference Championship', 'Super Bowl'];

/**
 * Regular-season weeks in an NFL season: 17 through 2020, 18 from 2021. An
 * unknown season reads as the current era, which is what a live page wants.
 */
export function nflRegularSeasonWeeks(season?: number | string | null): number {
    return season != null && Number(season) < NFL_SEVENTEEN_GAME_SEASON ? 17 : 18;
}

/** How a schedule row's week reads to a person: 'Week 5', 'Wild Card', 'Postseason'. */
export function weekLabel(
    league: League | undefined,
    week?: number | null,
    seasonType?: string | null,
    season?: number | string | null,
): string {
    if (!!seasonType && ((seasonType === 'preseason' || seasonType === 'PRE'))) {
        return 'Preseason';
    }

    const postseason = !!seasonType && ((seasonType !== 'regular' && seasonType != 'REG') || /^(post|post-?season|3)$/i.test(String(seasonType ?? '')));
    if (postseason && (league ?? DEFAULT_LEAGUE) === 'nfl' && week != null) {
        const availableWeeks = nflRegularSeasonWeeks(season) 
        const round = (week >= availableWeeks) ? NFL_POSTSEASON_ROUNDS[week - availableWeeks - 1] : NFL_POSTSEASON_ROUNDS[week - 1];
        return round ?? 'Postseason';
    } else if (postseason && (league ?? DEFAULT_LEAGUE) !== 'nfl') {
        return 'Postseason'
    }
    return week != null ? `Week ${week}` : '';
}

// A colon, not a dot or an em dash, and the abbreviation over the full name:
// docs/design-conventions.md §7-8 ("colons instead of dashes", "no interpunct/dot
// separators", "small screens get the abbreviation").
/** One completed meeting as a link label: 'Week 5: DEN 24-17 LAC'. */
export function meetingLabel(game: {
    season?: number | string | null; week?: number | null; season_type?: string | null;
    away_abbreviation?: string; away_team: string; away_points: number;
    home_abbreviation?: string; home_team: string; home_points: number;
}, league: League | undefined): string {
    const when = weekLabel(league, game.week, game.season_type, game.season);
    const away = game.away_abbreviation || game.away_team;
    const home = game.home_abbreviation || game.home_team;
    return `${when ? `${when}: ` : ''}${away} ${game.away_points}-${game.home_points} ${home}`;
}

/** Team-leaderboard categories a league serves: the shared three plus its extras. */
export function teamCategoriesFor(league: League | undefined): string[] {
    return ['differential', 'offensive', 'defensive', ...LEAGUES[league ?? DEFAULT_LEAGUE].extraTeamCategories];
}

/** '/nfl/game/1' -> { nfl, '/game/1' }, '/nba/players/1' -> { nba, '/players/1' }; anything else is cfb, untouched. */
export function splitLeague(pathname: string): { league: League; rest: string } {
    for (const lg of PREFIXED_LEAGUES) {
        const p = LEAGUES[lg].urlPrefix;
        if (pathname === p || pathname === p + '/') return { league: lg, rest: '/' };
        if (pathname.startsWith(p + '/')) return { league: lg, rest: pathname.slice(p.length) };
    }
    return { league: 'cfb', rest: pathname };
}

/** Prefix a site path for a league. cfb is the identity so existing links never change. */
export function leaguePath(league: League | undefined, path: string): string {
    const prefix = LEAGUES[league ?? DEFAULT_LEAGUE].urlPrefix;
    if (!prefix || path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) return path;
    if (path === '/') return prefix;
    return prefix + path;
}

/** Client-side (Svelte) league detection; SSR code reads Astro.locals.league instead. */
export function leagueFromLocation(): League {
    if (typeof window === 'undefined') return DEFAULT_LEAGUE;
    // An admin's /preview/<league>/... link is that league's page (middleware rewrites it), not a cfb path.
    return splitLeague(window.location.pathname.replace(/^\/preview(?=\/|$)/, '') || '/').league;
}
