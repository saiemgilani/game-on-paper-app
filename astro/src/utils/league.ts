import { AVAILABLE_SEASONS, CURRENT_YEAR } from './constants';

/**
 * The site renders one league per request. The NFL lives at explicit pages
 * under `pages/nfl/**` that set `Astro.locals.league` and render the shared
 * route components; resources and link builders read it. `cfb` is the
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
    /** SDV table holding the league's game schedule; the NFL's `schedule` is the
     *  nflverse frame, so its ESPN-shaped twin is published separately */
    scheduleTable: 'schedule' | 'espn_schedule';
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
        sdvApiBase: 'https://data.sportsdataverse.org/v1/cfb', sdvEnabled: true, scheduleTable: 'schedule',
        // getters, not values: constants.ts -> misc.ts -> league.ts -> constants.ts is a
        // cycle, and an eager read here sees AVAILABLE_SEASONS before it is initialised
        get seasons() { return AVAILABLE_SEASONS; }, regularSeasonWeeks: 15, postseasonWeeks: 1,
        logoLeague: 'ncaa', teamCount: 134, pool: 'FBS', extraTeamCategories: [],
    },
    nfl: {
        slug: 'nfl', name: 'NFL', shortName: 'NFL', urlPrefix: '/nfl',
        espnPath: 'nfl', espnCoreLeague: 'nfl',
        scoreboardQuery: '', defaultGroup: null, scoreboardCacheKey: 'scoreboard:nfl',
        sdvApiBase: 'https://data.sportsdataverse.org/v1/nfl', sdvEnabled: true, scheduleTable: 'espn_schedule',
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

/**
 * ESPN logo URL for a team, light or dark. Dark NFL logos go through the abbreviation
 * path; an NFL id missing from the map falls back to the light logo rather than a 404.
 */
export function teamLogoUrl(league: League | undefined, teamId: string | number, dark: boolean): string {
    const logoLeague = espnLogoLeague(league);
    const id = String(teamId);
    const light = `https://a.espncdn.com/i/teamlogos/${logoLeague}/500/${id}.png`;
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
const NFL_POSTSEASON_ROUNDS: Record<number, string> = {
    19: 'Wild Card', 20: 'Divisional', 21: 'Conference Championship', 22: 'Super Bowl',
};

/** How a schedule row's week reads to a person: 'Week 5', 'Wild Card', 'Postseason'. */
export function weekLabel(league: League | undefined, week?: number | null, seasonType?: string | null): string {
    const postseason = !!seasonType && seasonType !== 'regular';
    if (postseason) {
        const round = (league ?? DEFAULT_LEAGUE) === 'nfl' && week != null ? NFL_POSTSEASON_ROUNDS[week] : undefined;
        return round ?? 'Postseason';
    }
    return week != null ? `Week ${week}` : '';
}

// A colon, not a dot or an em dash, and the abbreviation over the full name:
// docs/design-conventions.md §7-8 ("colons instead of dashes", "no interpunct/dot
// separators", "small screens get the abbreviation").
/** One completed meeting as a link label: 'Week 5: DEN 24-17 LAC'. */
export function meetingLabel(game: {
    week?: number | null; season_type?: string | null;
    away_abbreviation?: string; away_team: string; away_points: number;
    home_abbreviation?: string; home_team: string; home_points: number;
}, league: League | undefined): string {
    const when = weekLabel(league, game.week, game.season_type);
    const away = game.away_abbreviation || game.away_team;
    const home = game.home_abbreviation || game.home_team;
    return `${when ? `${when}: ` : ''}${away} ${game.away_points}-${game.home_points} ${home}`;
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
