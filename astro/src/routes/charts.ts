/**
 * Page-side step of the chart builder: query parameters, the season-table read
 * and the cache policy. The template lives in `components/routes/ChartBuilderRoute.astro`.
 */
import type { AstroGlobal } from 'astro';
import { retrieveTeamSummaries } from '../resources/sdv';
import type { MarkMode } from '../utils/chartBuilder';
import { METRIC_YEAR } from '../utils/constants';
import { isFeatureEnabled } from '../utils/features';
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
    v2: boolean;
    highlight: string;
    mode: MarkMode;
}

export async function loadChartBuilder(Astro: AstroGlobal, league: League): Promise<ChartBuilderData> {
    Astro.locals.league = league;
    const query = Astro.url.searchParams;
    const season = query.get("season") || `${METRIC_YEAR}`;
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
    // v2-only view state (highlight, marks): read for a viewer the flag admits, empty for everyone else
    const v2 = isFeatureEnabled('chart-builder-v2', Astro.locals);
    const highlight = v2 ? (query.get('hl') ?? '').slice(0, 60) : '';
    const mode: MarkMode = v2 && query.get('mode') === 'dots' ? 'dots' : 'logos';
    return { league, season, metricX, metricY, points, v2, highlight, mode };
}
