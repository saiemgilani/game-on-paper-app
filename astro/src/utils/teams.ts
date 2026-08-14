import teamsRaw from '../static/teams.json' with { type: 'json' };

export interface TeamIndex { 
    team_id: number
    name: string
    seasons: number[]
}

export function retrieveAllTeams(): TeamIndex[] {
    try {
        const content = teamsRaw.teams as TeamIndex[]
        content.sort((a, b) => a.name.localeCompare(b.name));
        return content;
    } catch (err) {
        console.info(`error when loading team index: ${err}`)
        return [];
    }    
}