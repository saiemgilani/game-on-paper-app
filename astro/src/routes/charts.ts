/**
 * Page-side step of the chart builder: query parameters, the season-table read
 * and the cache policy. The template lives in `components/routes/ChartBuilderRoute.astro`.
 */
import type { AstroGlobal } from 'astro';
import { retrieveTeamSummaries } from '../resources/sdv';
import { LAST_YEAR } from '../utils/constants';
import type { League } from '../utils/league';

export interface ChartPoint {
    team_id: number | string;
    pos_team: string;
    x: number;
    x_rank: number;
    y: number;
    y_rank: number;
    conference: string;
    fbs_class: string;
}

export interface ChartBuilderData {
    league: League;
    season: string;
    metricX: string;
    metricY: string;
    points: ChartPoint[];
}

export async function loadChartBuilder(Astro: AstroGlobal, league: League): Promise<ChartBuilderData> {
    Astro.locals.league = league;
    const query = Astro.url.searchParams;
    const season = query.get("season") || `${LAST_YEAR}`;
    const metricX = query.get("x") || "adj_off_epa";
    const metricY = query.get("y") || "adj_def_epa";
    const teamData = await retrieveTeamSummaries({ season: Number(season), columns: [metricX, metricY], maxLookback: Number(season), league })
    const points: ChartPoint[] = teamData.map((t: any) => {
        return {
            team_id: t.team_id,
            pos_team: t.pos_team,
            x: t[metricX],
            x_rank: t[`${metricX}_rank`],
            y: t[metricY],
            y_rank: t[`${metricY}_rank`],
            conference: t.conference,
            fbs_class: t.fbs_class
        }
    })
    if (points.length > 0) {
        Astro.cache.set({
            maxAge: 60 * 60 * 24, // one day
            tags: ['chart', "favorites-enabled"],
        })
    } else {
        Astro.cache.set(false);
    }
    return { league, season, metricX, metricY, points };
}
