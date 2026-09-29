import type { SDVLeagueAverage } from '../resources/sdv';

/** `${category}:${metric}` -> that season's baseline row, for one level. */
export type LeagueAverageIndex = Map<string, SDVLeagueAverage>;

export function indexLeagueAverages(rows: SDVLeagueAverage[], level: string): LeagueAverageIndex {
    const out: LeagueAverageIndex = new Map();
    for (const r of rows) if (r.level === level) out.set(`${r.category}:${r.metric}`, r);
    return out;
}

export function leagueAverageFor(index: LeagueAverageIndex, category: string, metric: string): SDVLeagueAverage | undefined {
    return index.get(`${category}:${metric}`);
}
