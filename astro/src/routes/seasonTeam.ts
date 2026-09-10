/**
 * Page-side step of the season team page (`/year/[year]/team/[id]`): parameter
 * checks, the ESPN + season-table reads, and the not-found decision. The
 * template lives in `components/routes/SeasonTeamRoute.astro`.
 */
import type { AstroGlobal } from 'astro';
import { retrieveTeamInformation, type ESPNTeam } from '../resources/espn';
import {
    SummaryType, retrievePlayerSummaries, retrieveTeamSummaries, retrieveTeamSeasonInformation,
    type SDVPassingSummary, type SDVReceivingSummary, type SDVRushingSummary, type SDVTeamSeasonInformation, type SDVTeamSummary,
} from '../resources/sdv';
import type { League } from '../utils/league';

export interface SeasonTeamData {
    league: League;
    year: string;
    id: string;
    team: ESPNTeam;
    teamSeason: SDVTeamSeasonInformation | null;
    teamSummaries: SDVTeamSummary[];
    passers: SDVPassingSummary[];
    rushers: SDVRushingSummary[];
    receivers: SDVReceivingSummary[];
}

export type SeasonTeamResult = { notFound: true } | SeasonTeamData;

export async function loadSeasonTeam(Astro: AstroGlobal, league: League): Promise<SeasonTeamResult> {
    Astro.locals.league = league;
    const { year, id } = Astro.params;
    if (!year || !id) {
        Astro.cache.set(false);
        return { notFound: true };
    }
    let team: ESPNTeam | null = null;
    let teamSeason: SDVTeamSeasonInformation | null = null;
    let teamSummaries: SDVTeamSummary[] = [];
    try {
        team = await retrieveTeamInformation(id, league);
        teamSeason = await retrieveTeamSeasonInformation(year, id, league);
        teamSummaries = await retrieveTeamSummaries({ season: Number(year), team_id: Number(id), league });
    } catch (e: any) {
        console.error(`ERROR while loading team information: ${e}, ${e.stack}`)
        Astro.cache.set(false);
        return { notFound: true };
    }
    // the ESPN client hands the body back as-is; a null payload is not-found too
    if (!team) {
        Astro.cache.set(false);
        return { notFound: true };
    }
    const passers = (await retrievePlayerSummaries(Number(year), SummaryType.PASSING, Number(id), "plays", false, 10, Number(year), league)) as SDVPassingSummary[];
    const rushers = (await retrievePlayerSummaries(Number(year), SummaryType.RUSHING, Number(id), "plays", false, 20, Number(year), league)) as SDVRushingSummary[];
    const receivers = (await retrievePlayerSummaries(Number(year), SummaryType.RECEIVING, Number(id), "plays", false, 25, Number(year), league)) as SDVReceivingSummary[];
    return { league, year, id, team, teamSeason, teamSummaries, passers, rushers, receivers };
}
