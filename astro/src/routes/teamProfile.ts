/**
 * Page-side step of the team profile (`/team/[id]`): the ESPN + season-table
 * reads and the not-found decision. The template lives in
 * `components/routes/TeamProfileRoute.astro`.
 */
import type { AstroGlobal } from 'astro';
import { retrieveTeamInformation, type ESPNTeam } from '../resources/espn';
import { retrievePercentiles, retrieveTeamSummaries, type SDVSeasonPercentile, type SDVTeamSummary } from '../resources/sdv';
import type { League } from '../utils/league';

export interface TeamProfileData {
    league: League;
    id: string;
    team: ESPNTeam;
    percentiles: SDVSeasonPercentile[];
    teamSummaries: SDVTeamSummary[];
}

export type TeamProfileResult = { notFound: true } | TeamProfileData;

export async function loadTeamProfile(Astro: AstroGlobal, league: League): Promise<TeamProfileResult> {
    Astro.locals.league = league;
    const { id } = Astro.params;
    if (!id) {
        Astro.cache.set(false);
        return { notFound: true };
    }
    let team: ESPNTeam | null = null;
    try {
        team = await retrieveTeamInformation(id, league);
    } catch (e: any) {
        console.error(`ERROR while loading team ${id}: ${e}, ${e.stack}`);
    }
    // a rejected request or a null payload (the ESPN client hands the body back as-is)
    if (!team) {
        Astro.cache.set(false);
        return { notFound: true };
    }
    let percentiles: SDVSeasonPercentile[] = [];
    for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
        percentiles = percentiles.concat(await retrievePercentiles(undefined, p, undefined, league));
    }
    const teamSummaries = await retrieveTeamSummaries({ team_id: Number(id), league });
    return { league, id, team, percentiles, teamSummaries };
}
