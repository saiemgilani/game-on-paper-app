import type { Team } from './teams';

// The WNBA's franchises, keyed by stats.wnba.com team id, from wehoop-wnba-data's team crosswalk
// (wnba/crosswalk/parquet/wnba_team_crosswalk_{2002..2026}.parquet, 5d64639c; test/fixtures/wnba/team_crosswalk_2002_2026.json
// holds it and teams.test.ts pins this file to it). Colours are ESPN's `team.color`
// (site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams, 2026-10-12). Tricodes are stats.wnba.com's 2026 ones.
export const WNBA_TEAMS: readonly Team[] = [
    { team_id: 1611661330, tricode: 'ATL', name: 'Atlanta Dream', color: '#E31837', espn_id: 20 },
    { team_id: 1611661329, tricode: 'CHI', name: 'Chicago Sky', color: '#5091CD', espn_id: 19 },
    { team_id: 1611661323, tricode: 'CON', name: 'Connecticut Sun', color: '#F05023', espn_id: 18 },
    { team_id: 1611661321, tricode: 'DAL', name: 'Dallas Wings', color: '#002B5C', espn_id: 3 },
    { team_id: 1611661331, tricode: 'GSV', name: 'Golden State Valkyries', color: '#B38FCF', espn_id: 129689 },
    { team_id: 1611661325, tricode: 'IND', name: 'Indiana Fever', color: '#002D62', espn_id: 5 },
    { team_id: 1611661319, tricode: 'LVA', name: 'Las Vegas Aces', color: '#A7A8AA', espn_id: 17 },
    { team_id: 1611661320, tricode: 'LAS', name: 'Los Angeles Sparks', color: '#552583', espn_id: 6 },
    { team_id: 1611661324, tricode: 'MIN', name: 'Minnesota Lynx', color: '#266092', espn_id: 8 },
    { team_id: 1611661313, tricode: 'NYL', name: 'New York Liberty', color: '#86CEBC', espn_id: 9 },
    { team_id: 1611661317, tricode: 'PHX', name: 'Phoenix Mercury', color: '#3C286E', espn_id: 11 },
    { team_id: 1611661327, tricode: 'PDX', name: 'Portland Fire', color: '#CEE5EB', espn_id: 132052 },
    { team_id: 1611661328, tricode: 'SEA', name: 'Seattle Storm', color: '#2C5235', espn_id: 14 },
    { team_id: 1611661332, tricode: 'TOR', name: 'Toronto Tempo', color: '#33476D', espn_id: 131935 },
    { team_id: 1611661322, tricode: 'WAS', name: 'Washington Mystics', color: '#E03A3E', espn_id: 16 },
];

/**
 * Names a current franchise had before (relocations, renames, a tricode change), with the last season (year) each applied.
 * Within a franchise the rows run oldest first: wnbaEraTricode takes the first whose `through` covers the season.
 */
export const WNBA_FORMER_NAMES: readonly { team_id: number; tricode: string; through: number; name: string }[] = [
    { team_id: 1611661321, tricode: 'DET', through: 2009, name: 'Detroit Shock' },
    { team_id: 1611661321, tricode: 'TUL', through: 2015, name: 'Tulsa Shock' },
    { team_id: 1611661319, tricode: 'UTA', through: 2002, name: 'Utah Starzz' },
    { team_id: 1611661319, tricode: 'SAN', through: 2013, name: 'San Antonio Silver Stars' },
    { team_id: 1611661319, tricode: 'SAN', through: 2017, name: 'San Antonio Stars' },
    { team_id: 1611661323, tricode: 'ORL', through: 2002, name: 'Orlando Miracle' },
    { team_id: 1611661317, tricode: 'PHO', through: 2024, name: 'Phoenix Mercury' },
];

/**
 * Franchises that folded, with their last season. The 2000-02 Portland Fire shares stats id 1611661327 with the 2026
 * expansion Portland Fire (stats.wnba.com reused it); they are different franchises, so ESPN id 12 resolves to no team.
 * The crosswalk starts in 2002: first seasons are not listed.
 */
export const WNBA_DEFUNCT: readonly { team_id: number; espn_id: number; tricode: string; name: string; through: number }[] = [
    { team_id: 1611661314, espn_id: 1, tricode: 'CHA', name: 'Charlotte Sting', through: 2006 },
    { team_id: 1611661315, espn_id: 2, tricode: 'CLE', name: 'Cleveland Rockers', through: 2003 },
    { team_id: 1611661316, espn_id: 4, tricode: 'HOU', name: 'Houston Comets', through: 2008 },
    { team_id: 1611661326, espn_id: 7, tricode: 'MIA', name: 'Miami Sol', through: 2002 },
    { team_id: 1611661327, espn_id: 12, tricode: 'POR', name: 'Portland Fire', through: 2002 },
    { team_id: 1611661318, espn_id: 13, tricode: 'SAC', name: 'Sacramento Monarchs', through: 2009 },
];

const BY_ID = new Map(WNBA_TEAMS.map((t) => [t.team_id, t]));
/** Current ESPN ids, plus the ESPN ids a relocated franchise had before (Utah Starzz 15, Orlando Miracle 10). */
const BY_ESPN_ID = new Map<number, Team>([
    ...WNBA_TEAMS.map((t) => [t.espn_id, t] as [number, Team]),
    [15, BY_ID.get(1611661319)!],
    [10, BY_ID.get(1611661323)!],
]);

export function wnbaTeamByEspnId(espnId: number): Team | undefined {
    return BY_ESPN_ID.get(espnId);
}

export function wnbaTeamById(teamId: number): Team | undefined {
    return BY_ID.get(teamId);
}

/**
 * The tricode a franchise used in `season` when it differs from today's, else undefined: ESPN id 3 is DET through 2009
 * (ESPN's own 2005 payloads spell it "TUL"), Phoenix PHO through 2024. Keyed by ESPN id and season, never by name (D22).
 */
export function wnbaEraTricode(espnId: number, season: number | null | undefined): string | undefined {
    const id = wnbaTeamByEspnId(espnId)?.team_id;
    if (id == null || season == null) return undefined;
    return WNBA_FORMER_NAMES.find((f) => f.team_id === id && season <= f.through)?.tricode;
}
