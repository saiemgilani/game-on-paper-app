/**
 * Page-side step of the season team page (`/year/[year]/team/[id]`): parameter
 * checks, the ESPN + season-table reads, and the not-found decision. The
 * template lives in `components/routes/SeasonTeamRoute.astro`.
 */
import type { AstroGlobal } from 'astro';
import { retrieveTeamInformation, type ESPNTeam } from '../resources/espn';
import {
    SummaryType, retrievePlayerSummaries, retrieveTeamSummaries, retrieveTeamSeasonInformation, retrieveTeamTendencies, teamSummaryColumns,
    type SDVPassingSummary, type SDVReceivingSummary, type SDVRushingSummary, type SDVTeamSeasonInformation, type SDVTeamSummary, type SDVTeamTendency,
} from '../resources/sdv';
import { isFeatureEnabled } from '../utils/features';
import { fiveFactorColumns } from '../utils/fiveFactors';
import type { League } from '../utils/league';
import { teamSplitColumns } from '../utils/teamSplits';

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
    /** the team's team_tendencies row; read only with 'team-splits' on */
    teamTendency?: SDVTeamTendency;
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
        // flag off: no `columns`, so the request and its cache key are unchanged
        const columns = isFeatureEnabled('five-factors', Astro.locals) ? [...teamSummaryColumns(league), ...fiveFactorColumns()] : undefined;
        teamSummaries = await retrieveTeamSummaries({ season: Number(year), team_id: Number(id), league, columns });
    } catch (e: any) {
        console.error(`ERROR while loading team information: ${e}, ${e.stack}`)
        Astro.cache.set(false);
        return { notFound: true };
    }
    // the ESPN client hands the body back as-is: a null payload or ESPN's 400 body
    // ({"error": ...}, no id) for an unknown team is not-found too
    if (!team?.id) {
        Astro.cache.set(false);
        return { notFound: true };
    }
    // started before the player reads and awaited after them, so it overlaps them
    // instead of adding a round trip; it never rejects ([] on any failure). Flag
    // off: no request, and the player reads run exactly as before.
    const tendencies = isFeatureEnabled('team-splits', Astro.locals)
        ? retrieveTeamTendencies({ season: Number(year), league, columns: teamSplitColumns(league), teamId: Number(id) })
        : undefined;
    const passers = (await retrievePlayerSummaries(Number(year), SummaryType.PASSING, Number(id), "plays", false, 10, Number(year), league)) as SDVPassingSummary[];
    const rushers = (await retrievePlayerSummaries(Number(year), SummaryType.RUSHING, Number(id), "plays", false, 20, Number(year), league)) as SDVRushingSummary[];
    const receivers = (await retrievePlayerSummaries(Number(year), SummaryType.RECEIVING, Number(id), "plays", false, 25, Number(year), league)) as SDVReceivingSummary[];
    const teamTendency = (await tendencies)?.[0];
    return { league, year, id, team, teamSeason, teamSummaries, passers, rushers, receivers, teamTendency };
}
