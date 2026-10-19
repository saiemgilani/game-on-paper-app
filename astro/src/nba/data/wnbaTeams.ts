import { WNBA_LAST_KNOWN_SEASON } from '../seasonRange';
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
 * `logo` is that era's logo key (wnbaLogoId), looked up in utils/league.ts: ESPN's era file (WNBA_LOGO_ABBR) or a site-hosted
 * WNBA.com 2002 mark (WNBA_HOSTED_LOGOS). Phoenix's PHO row is the same team, so it has none.
 */
export const WNBA_FORMER_NAMES: readonly { team_id: number; tricode: string; through: number; name: string; logo?: string }[] = [
    { team_id: 1611661321, tricode: 'DET', through: 2009, name: 'Detroit Shock', logo: 'det' },
    { team_id: 1611661321, tricode: 'TUL', through: 2015, name: 'Tulsa Shock', logo: 'tul' },
    { team_id: 1611661319, tricode: 'UTA', through: 2002, name: 'Utah Starzz', logo: 'uta' },
    { team_id: 1611661319, tricode: 'SAN', through: 2013, name: 'San Antonio Silver Stars', logo: 'sas' },
    { team_id: 1611661319, tricode: 'SAN', through: 2017, name: 'San Antonio Stars', logo: 'sa' },
    { team_id: 1611661323, tricode: 'ORL', through: 2002, name: 'Orlando Miracle', logo: 'orl' },
    { team_id: 1611661317, tricode: 'PHO', through: 2024, name: 'Phoenix Mercury' },
];

/**
 * Franchises that folded, with their last season. The 2000-02 Portland Fire shares stats id 1611661327 with the 2026
 * expansion Portland Fire (stats.wnba.com reused it); they are different franchises, so ESPN id 12 resolves to no team.
 * ESPN itself now files the old Fire under the new one's id (132052 on its 2002 boards); wnbaLogoId undoes that for logos.
 * `from` is the first season, from the shots (WNBA_FIRST_SEASONS says where; the crosswalk starts in 2002).
 */
export const WNBA_DEFUNCT: readonly { team_id: number; espn_id: number; tricode: string; name: string; from: number; through: number }[] = [
    { team_id: 1611661314, espn_id: 1, tricode: 'CHA', name: 'Charlotte Sting', from: 1997, through: 2006 },
    { team_id: 1611661315, espn_id: 2, tricode: 'CLE', name: 'Cleveland Rockers', from: 1997, through: 2003 },
    { team_id: 1611661316, espn_id: 4, tricode: 'HOU', name: 'Houston Comets', from: 1997, through: 2008 },
    { team_id: 1611661326, espn_id: 7, tricode: 'MIA', name: 'Miami Sol', from: 2000, through: 2002 },
    { team_id: 1611661327, espn_id: 12, tricode: 'POR', name: 'Portland Fire', from: 2000, through: 2002 },
    { team_id: 1611661318, espn_id: 13, tricode: 'SAC', name: 'Sacramento Monarchs', from: 1997, through: 2009 },
];

/**
 * Each current franchise's first season under any name (Las Vegas from the 1997 Utah Starzz, Dallas from the 1998 Detroit
 * Shock); 1611661327 is the 2026 Fire, the 2000-02 one is WNBA_DEFUNCT's. The first regular-season (102...) shots season of
 * each stats team id in wehoop-wnba-stats-data's shots_1997..2026 (test/fixtures/wnba/team_seasons_1997_2026.json pins it).
 */
export const WNBA_FIRST_SEASONS: Readonly<Record<number, number>> = {
    1611661313: 1997, 1611661317: 1997, 1611661319: 1997, 1611661320: 1997, 1611661321: 1998, 1611661322: 1998,
    1611661323: 1999, 1611661324: 1999, 1611661325: 2000, 1611661328: 2000, 1611661329: 2006, 1611661330: 2008,
    1611661331: 2025, 1611661327: 2026, 1611661332: 2026,
};

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

/** The former identity a current team had in `season` (a relocation or rename), else undefined. Phoenix's PHO row is today's name. */
function formerEra(team: Team | undefined, season: number | null | undefined) {
    if (team == null || season == null) return undefined;
    const era = WNBA_FORMER_NAMES.find((f) => f.team_id === team.team_id && season <= f.through);
    return era && era.name !== team.name ? era : undefined;
}

/**
 * The team as it was in `season`: a folded franchise by its own name in its seasons, else the current franchise under
 * the name it had then (WNBA_FORMER_NAMES, first `through` at or after the season). A folded franchise has its own
 * historical logo (plan #5 hosts CLE, MIA and the 2000-02 POR; CHA, HOU and SAC come from ESPN) but no current
 * colour, so it is grey #888888. The season decides, not the id: 1611661327 is the 2000-02 Portland Fire through 2002
 * and the 2026 Portland Fire after.
 */
export function wnbaTeamInSeason(teamId: number, season: number): Team | undefined {
    const folded = WNBA_DEFUNCT.find((d) => d.team_id === teamId && season <= d.through);
    if (folded) return { team_id: teamId, tricode: folded.tricode, name: folded.name, color: '#888888', espn_id: folded.espn_id };
    const t = BY_ID.get(teamId);
    if (!t) return undefined;
    return { ...t, name: WNBA_FORMER_NAMES.find((f) => f.team_id === teamId && season <= f.through)?.name ?? t.name };
}

/**
 * The seasons of the franchise that holds `teamId` in `season`, through the last listed season: 1611661327 is 2000-2002 in
 * 2002 and 2026 in 2026 (two franchises, one stats id). Undefined for an id no franchise had.
 */
export function wnbaSeasonsOf(teamId: number, season: number): number[] | undefined {
    const folded = WNBA_DEFUNCT.find((d) => d.team_id === teamId && season <= d.through);
    const first = folded ? folded.from : WNBA_FIRST_SEASONS[teamId];
    if (first == null) return undefined;
    const last = folded ? folded.through : WNBA_LAST_KNOWN_SEASON;
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** The current franchise behind a tricode it has used (SAN and UTA are Las Vegas); a folded franchise's tricode has none. */
export function wnbaFranchiseOf(tricode: string): number | undefined {
    return (WNBA_TEAMS.find((t) => t.tricode === tricode) ?? WNBA_FORMER_NAMES.find((f) => f.tricode === tricode))?.team_id;
}

/**
 * The key a team's logo is looked up by in `season` (D22: ESPN id + season, never the name). A relocated franchise's era
 * draws that era's logo: ESPN id 3 is `det` through 2009, `tul` through 2015, then Dallas's 3. Where ESPN files a folded
 * franchise under a current team's id (its 2002 boards carry the 2000-02 Portland Fire as 132052, the 2026 Fire), it is the
 * old franchise's id (12). Otherwise, and with no season, the id itself.
 */
export function wnbaLogoId(espnId: string | number, season?: number | null): string {
    const current = season == null ? undefined : BY_ESPN_ID.get(Number(espnId));
    const folded = current && WNBA_DEFUNCT.find((d) => d.team_id === current.team_id && season! <= d.through);
    return String(folded ? folded.espn_id : formerEra(current, season)?.logo ?? espnId);
}

/**
 * The tricode a franchise used in `season` when it was another team then (a relocation or rename), else undefined: ESPN id 3
 * is DET through 2009 (ESPN's own 2005 payloads spell it "TUL"). A former-name row whose name is today's (Phoenix's PHO, a
 * stats.wnba.com-only code) is no other identity, so ESPN's abbreviation stands. Keyed by ESPN id and season, never by name (D22).
 */
export function wnbaEraTricode(espnId: number, season: number | null | undefined): string | undefined {
    return formerEra(wnbaTeamByEspnId(espnId), season)?.tricode;
}
