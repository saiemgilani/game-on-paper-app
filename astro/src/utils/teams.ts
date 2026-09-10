import teamsRaw from '../static/teams.json' with { type: 'json' };
import nflTeamsRaw from '../static/nfl_teams.json' with { type: 'json' };
import type { League } from './league';

export interface TeamIndex {
    team_id: number
    name: string
    seasons: number[]
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
