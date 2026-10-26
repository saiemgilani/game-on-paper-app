/**
 * Page-side step of the team profile (`/team/[id]`): the ESPN + season-table
 * reads and the not-found decision. The template lives in
 * `components/routes/TeamProfileRoute.astro`.
 */
import type { AstroGlobal } from 'astro';
import { retrieveTeamInformation, type ESPNTeam } from '../resources/espn';
import { retrievePercentiles, retrieveTeamSeasonPercentiles, retrieveTeamSummaries, type SDVSeasonPercentile, type SDVTeamSeasonBand, type SDVTeamSummary } from '../resources/sdv';
import { isFeatureEnabled } from '../utils/features';
import type { League } from '../utils/league';

export interface TeamProfileData {
    league: League;
    id: string;
    team: ESPNTeam;
    /** the team-game ladder rows; with `seasonBands`, the team-season ladder points instead */
    percentiles: SDVSeasonPercentile[] | SDVTeamSeasonBand[];
    teamSummaries: SDVTeamSummary[];
    /** 'team-season-bands' */
    seasonBands: boolean;
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
    // a rejected request, a null payload, or ESPN's 400 body ({"error": ...}) for an
    // unknown id -- the client hands the body back as-is, so "no id" is the test
    if (!team?.id) {
        Astro.cache.set(false);
        return { notFound: true };
    }
    const seasonBands = isFeatureEnabled('team-season-bands', Astro.locals);
    let percentiles: SDVSeasonPercentile[] | SDVTeamSeasonBand[] = [];
    if (seasonBands) {
        percentiles = await retrieveTeamSeasonPercentiles(league);
    } else {
        let ladder: SDVSeasonPercentile[] = [];
        for (const p of [0.01, 0.25, 0.5, 0.75, 0.99]) {
            ladder = ladder.concat(await retrievePercentiles(undefined, p, undefined, league));
        }
        percentiles = ladder;
    }
    const teamSummaries = await retrieveTeamSummaries({ team_id: Number(id), league });
    return { league, id, team, percentiles, teamSummaries, seasonBands };
}
