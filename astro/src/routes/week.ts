/**
 * The week-schedule page's data step, shared by
 * `pages/year/[year]/type/[type]/week/[week].astro` (cfb) and its `pages/nfl/` twin.
 */
import type { AstroGlobal } from 'astro';
import { type ESPNScheduleEvent, getCurrentScoreboard, getRemoteGames } from '../resources/espn';
import { CACHE_TTL_MULTIPLIER, CURRENT_SEASON_CONFIG, getScheduleCacheConfig } from '../utils/config';
import { CURRENT_YEAR } from '../utils/constants';
import { LEAGUES, type League } from '../utils/league';

export interface WeekRouteData {
    season: number;
    seasontype: number;
    week: number;
    group: number | undefined;
    games: ESPNScheduleEvent[];
}

/**
 * The week and season type the league's scoreboard is on (the same read, and the same `week.number` / `season.type`,
 * the scoreboard page hands its picker), when it is on `season`'s regular season or postseason. Null otherwise
 * (the off-season, preseason, another season, or a failed read), and the caller keeps week 1.
 */
export async function currentWeek(season: number, league: League): Promise<{ week: number; seasontype: number } | null> {
    try {
        const first: ESPNScheduleEvent | undefined = (await getCurrentScoreboard(true, true, league))[0];
        const week = Number(first?.week?.number), seasontype = Number(first?.season?.type);
        if (Number(first?.season?.year) !== season || !(seasontype === 2 || seasontype === 3) || !(week > 0)) return null;
        return { week, seasontype };
    } catch (e) {
        console.error(`ERROR while reading the ${league} scoreboard for the current week: ${e}`);
        return null;
    }
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
    const season = int(year, CURRENT_YEAR);
    // #150: /year/<season> with no type or week (the picker submitted with only a conference, say) is the scoreboard's
    // current week when <season> is the one the scoreboard is on; otherwise, and for a past season, week 1.
    const current = (type == null && week == null && season === CURRENT_YEAR) ? await currentWeek(season, league) : null;
    const weekCleaned = current?.week ?? int(week, 1);
    const seasontype = current?.seasontype ?? int(type, 2);

    let games: ESPNScheduleEvent[] = [];
    try {
        games = await getRemoteGames(season, seasontype, weekCleaned, group, league);
        const hasActiveGames = games.find((item: ESPNScheduleEvent) => item.status && !(item.status?.type.completed == true || item.status?.type.name.includes("SCHEDULED") || item.status?.type.name.includes("CANCEL") || item.status?.type.name.includes("POSTPONE") || item.status?.type.name.includes("DELAY")))
        // a defaulted week moves with the scoreboard, so the URL is held only as long as the scoreboard is
        const config = current
            ? { maxAge: CURRENT_SEASON_CONFIG.scoreboardRefreshRate, swr: CURRENT_SEASON_CONFIG.scoreboardRefreshRate * CACHE_TTL_MULTIPLIER, tags: ['week-in-progress'] }
            : getScheduleCacheConfig(new Date(), season, seasontype, weekCleaned, !!hasActiveGames, league);
        Astro.cache.set(config);
    } catch (e) {
        console.error(`ERROR while fetching games for ${JSON.stringify(Astro.props)}: ${e}`)
        Astro.cache.set(false);
        // make sure the page still loads
        games = [];
    }
    return { season, seasontype, week: weekCleaned, group, games };
}
