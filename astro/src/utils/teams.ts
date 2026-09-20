import teamsRaw from '../static/teams.json' with { type: 'json' };
import nflTeamsRaw from '../static/nfl_teams.json' with { type: 'json' };
import type { League } from './league';

export interface TeamIndex {
    team_id: number
    name: string
    /** nfl only; the abbreviation the nflverse feeds key on */
    abbr?: string
    seasons: number[]
}

/**
 * ESPN team id for an NFL abbreviation ("LAC" -> 24). The nflverse-backed
 * player game log names an opponent by abbreviation, but every team URL and
 * every `DarkModeLogos` rule is keyed on the ESPN id, so an unresolved
 * abbreviation means both a dead link and a light logo in dark mode.
 */
const NFL_ID_BY_ABBR: Record<string, number> = Object.fromEntries(
    ((nflTeamsRaw.teams ?? []) as TeamIndex[]).filter((t) => t.abbr).map((t) => [t.abbr as string, t.team_id]),
);

/**
 * nflverse spells four of the 32 differently from ESPN, plus the three relocated
 * franchises its historical rows still carry. Everything else matches, so this
 * stays a short alias list rather than a second team table.
 */
const NFLVERSE_ABBR_ALIASES: Record<string, string> = {
    LA: 'LAR', STL: 'LAR', WAS: 'WSH', OAK: 'LV', SD: 'LAC', SL: 'LAR',
};

export function nflTeamIdByAbbr(abbr: string | number | null | undefined): number | null {
    const key = String(abbr ?? '').toUpperCase();
    return NFL_ID_BY_ABBR[key] ?? NFL_ID_BY_ABBR[NFLVERSE_ABBR_ALIASES[key] ?? ''] ?? null;
}

/** Every team the site knows for a league, name-sorted. ESPN ids; cfb is the historical default. */
export function retrieveAllTeams(league: League = 'cfb'): TeamIndex[] {
    try {
        const raw = league === 'nfl' ? nflTeamsRaw : teamsRaw;
        const content = raw.teams as TeamIndex[]
        content.sort((a, b) => a.name.localeCompare(b.name));
        return content;
    } catch (err) {
        console.info(`error when loading team index: ${err}`)
        return [];
    }
}
