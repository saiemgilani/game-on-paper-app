import { AVAILABLE_SEASONS, CURRENT_YEAR } from './constants';

/**
 * The site renders one league per request. Middleware sets
 * `Astro.locals.league` from the URL prefix (`/nfl/*`) and rewrites onto the
 * shared page files; resources and link builders read it. `cfb` is the
 * unprefixed default, so every pre-existing URL, cache key and KV key is
 * untouched.
 */
export type League = 'cfb' | 'nfl';
export const DEFAULT_LEAGUE: League = 'cfb';

export interface LeagueConfig {
    slug: League;
    name: string;
    shortName: string;
    /** site URL prefix; '' for the default league */
    urlPrefix: '' | '/nfl';
    /** cdn.espn.com/core/<espnPath>/…, www.espn.com/<espnPath>/…, s.espncdn.com stitcher path */
    espnPath: 'college-football' | 'nfl';
    /** sports.core.api.espn.com/v2/sports/football/leagues/<espnCoreLeague> */
    espnCoreLeague: 'college-football' | 'nfl';
    /** extra query prepended on the cdn scoreboard call (cfb: FBS group + limit) */
    scoreboardQuery: string;
    /** cdn schedule `group` param; null = the league has no conference grouping */
    defaultGroup: number | null;
    /** KV key for the cached scoreboard; cfb keeps the historical bare key */
    scoreboardCacheKey: string;
    sdvApiBase: string;
    /** false until the league's season tables exist on the SDV API */
    sdvEnabled: boolean;
    seasons: number[];
    regularSeasonWeeks: number;
    postseasonWeeks: number;
    /** a.espncdn.com/i/teamlogos/<logoLeague>/500/<team id>.png */
    logoLeague: 'ncaa' | 'nfl';
    /** teams ranked in a season table; the rank colour ramp scales to it */
    teamCount: number;
    /** the population the season tables describe, for copy ("FBS vs FBS games only") */
    pool: string;
    /** team-leaderboard categories beyond the shared differential/offensive/defensive */
    extraTeamCategories: string[];
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const LEAGUES: Record<League, LeagueConfig> = {
    cfb: {
        slug: 'cfb', name: 'College Football', shortName: 'CFB', urlPrefix: '',
        espnPath: 'college-football', espnCoreLeague: 'college-football',
        scoreboardQuery: 'group=80&limit=1000&', defaultGroup: 80, scoreboardCacheKey: 'scoreboard',
        sdvApiBase: 'https://data.sportsdataverse.org/v1/cfb', sdvEnabled: true,
        // getters, not values: constants.ts -> misc.ts -> league.ts -> constants.ts is a
        // cycle, and an eager read here sees AVAILABLE_SEASONS before it is initialised
        get seasons() { return AVAILABLE_SEASONS; }, regularSeasonWeeks: 15, postseasonWeeks: 1,
        logoLeague: 'ncaa', teamCount: 134, pool: 'FBS', extraTeamCategories: [],
    },
    nfl: {
        slug: 'nfl', name: 'NFL', shortName: 'NFL', urlPrefix: '/nfl',
        espnPath: 'nfl', espnCoreLeague: 'nfl',
        scoreboardQuery: '', defaultGroup: null, scoreboardCacheKey: 'scoreboard:nfl',
        sdvApiBase: 'https://data.sportsdataverse.org/v1/nfl', sdvEnabled: false,
        // ESPN play-by-play for the NFL is reliable from the 2002 realignment on
        get seasons() { return range(2002, CURRENT_YEAR); }, regularSeasonWeeks: 18, postseasonWeeks: 5,
        logoLeague: 'nfl', teamCount: 32, pool: 'NFL',
        // the rbsdm.com measures the nfl-data producer adds to team_summaries
        extraTeamCategories: ['tendencies', 'fourth-downs', 'luck'],
    },
};

/** ESPN logo path segment for a league's team ids (numeric ids resolve for both). */
export function espnLogoLeague(league: League | undefined): 'ncaa' | 'nfl' {
    return LEAGUES[league ?? DEFAULT_LEAGUE].logoLeague;
}

/** Team-leaderboard categories a league serves: the shared three plus its extras. */
export function teamCategoriesFor(league: League | undefined): string[] {
    return ['differential', 'offensive', 'defensive', ...LEAGUES[league ?? DEFAULT_LEAGUE].extraTeamCategories];
}

/** '/nfl/game/1' -> { nfl, '/game/1' }; anything else is cfb, untouched. */
export function splitLeague(pathname: string): { league: League; rest: string } {
    const p = LEAGUES.nfl.urlPrefix;
    if (pathname === p || pathname === p + '/') return { league: 'nfl', rest: '/' };
    if (pathname.startsWith(p + '/')) return { league: 'nfl', rest: pathname.slice(p.length) };
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
    return splitLeague(window.location.pathname).league;
}
