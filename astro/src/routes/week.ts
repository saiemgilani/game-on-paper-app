/**
 * The week-schedule page's data step, shared by
 * `pages/year/[year]/type/[type]/week/[week].astro` (cfb) and its `pages/nfl/` twin.
 */
import type { AstroGlobal } from 'astro';
import { type ESPNScheduleEvent, getRemoteGames } from '../resources/espn';
import { getScheduleCacheConfig } from '../utils/config';
import { CURRENT_YEAR } from '../utils/constants';
import { LEAGUES, type League } from '../utils/league';

export interface WeekRouteData {
    season: number;
    seasontype: number;
    week: number;
    group: number | undefined;
    games: ESPNScheduleEvent[];
}

export async function loadWeek(Astro: AstroGlobal, league: League): Promise<WeekRouteData> {
    Astro.locals.league = league;
    const cfg = LEAGUES[league];
    const { year, type, week } = Astro.params;
    // a league without conference grouping (nfl) has no group at all
    const groupRaw = Astro.url.searchParams.get("group") || String(cfg.defaultGroup ?? "");
    const group = cfg.defaultGroup === null ? undefined : parseInt(groupRaw || `${cfg.defaultGroup}`);
    // a malformed param falls back to its default rather than sending NaN to
    // ESPN (which drops the filter and returns the whole season)
    const int = (raw: string | undefined, fallback: number) => {
        const v = parseInt(raw ?? "");
        return Number.isFinite(v) ? v : fallback;
    };
    const weekCleaned = int(week, 1);
    const season = int(year, CURRENT_YEAR);
    const seasontype = int(type, 2);

    let games: ESPNScheduleEvent[] = [];
    try {
        games = await getRemoteGames(season, seasontype, weekCleaned, group, league);
        const hasActiveGames = games.find((item: ESPNScheduleEvent) => item.status && !(item.status?.type.completed == true || item.status?.type.name.includes("SCHEDULED") || item.status?.type.name.includes("CANCEL") || item.status?.type.name.includes("POSTPONE") || item.status?.type.name.includes("DELAY")))
        const config = getScheduleCacheConfig(new Date(), season, seasontype, weekCleaned, !!hasActiveGames, league);
        Astro.cache.set(config);
    } catch (e) {
        console.error(`ERROR while fetching games for ${JSON.stringify(Astro.props)}: ${e}`)
        Astro.cache.set(false);
        // make sure the page still loads
        games = [];
    }
    return { season, seasontype, week: weekCleaned, group, games };
}
