/**
 * Page-side step of BB-G47's league hub (/<league> behind 'bball-hub'): ESPN's current day through the scoreboard's own
 * prepare (same read, same cache policy, the default college group), each game's market line from game_lines, and the page
 * index. The template is components/routes/BasketballHubRoute.astro.
 *
 * Extension points: BB-G48 ("Tonight": standouts, the most dramatic games) and BB-G49 (snapshots, matchup predictor, follow a
 * team) add their own fields to BasketballHubParams and their own sections to the template; nothing here needs to change.
 */
import type { AstroGlobal } from 'astro';
import { prepareBasketballScoreboard, type BasketballScoreboardParams } from './scoreboard';
import { retrieveGameLines } from '../../resources/gameLines';
import { followTeams, hubIndex, hubLine, sparkline, standouts, warLeaders, type FollowTeam, type HubLine, type HubLink, type Standout, type WarLeader } from '../../basketball/hub';
import { retrieveDayBox, retrieveFinalsWp } from '../../resources/hubTonight';
import { retrieveFollowSchedule, retrieveWarLeaders } from '../../resources/hubDashboards';
import { isFeatureEnabled } from '../../utils/features';
import { cleanAbbreviation } from '../../utils/misc';
import { LEAGUES, type BasketballLeague } from '../../utils/league';

export interface BasketballHubParams {
    board: BasketballScoreboardParams;
    /** ESPN game id -> its line; a game without one is absent */
    lines: Record<string, HubLine>;
    index: HubLink[];
    /** BB-G48, behind 'bball-hub-tonight'; absent with the flag off */
    tonight?: HubTonight;
    /** BB-G49, behind 'bball-hub-dashboards'; absent with the flag off */
    dashboards?: HubDashboards;
}

export interface HubDashboards {
    /** the WAR board's season (end year) */
    warSeason: number;
    war: WarLeader[];
    /** every team the "follow a team" picker offers, with what its card shows; the browser keeps the choice */
    follow: FollowTeam[];
}

export interface HubTonight {
    /** the day the standouts are from: the board's, or the one before when the nightly has not reached the board's finals */
    day: string | null;
    standouts: Standout[];
    /** ESPN game id -> its card's sparkline points; a final without ingested play_wp is absent */
    sparklines: Record<string, string>;
}

/** The standouts read: the board's day when it has a final, else (or when that day is not ingested yet) the day before. */
async function prepareTonight(league: BasketballLeague, board: BasketballScoreboardParams): Promise<HubTonight> {
    const finals = board.games.filter((g) => (g.competitions[0].status ?? g.status)?.type?.completed === true && g.season?.year != null)
        .map((g) => ({ id: g.id, season: g.season.year }));
    const seasons = LEAGUES[league].seasons;
    const season = board.games.find((g) => g.season?.year != null)?.season.year ?? seasons[seasons.length - 1];
    const dayBox = async () => {
        if (finals.length) { const r = await retrieveDayBox(league, season, board.day); if (r.length) return { day: board.day, r }; }
        const r = await retrieveDayBox(league, season, board.nav.prev);
        return { day: r.length ? board.nav.prev : null, r };
    };
    const [box, wp] = await Promise.all([dayBox(), finals.length ? retrieveFinalsWp(league, finals) : new Map<string, (number | null)[]>()]);
    const sparklines: Record<string, string> = {};
    for (const [id, v] of wp) { const pts = sparkline(v); if (pts) sparklines[id] = pts; }
    return { day: box.day, standouts: standouts(box.r), sparklines };
}

export async function prepareBasketballHub(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballHubParams> {
    const board = await prepareBasketballScoreboard(Astro, league, { today: true });
    // `today` sends no ?date= or ?group=, the only inputs a bad-date answer comes from
    if ('badDate' in board) throw new Error(`${league} hub: the scoreboard refused its own current day`);
    const games = board.games.filter((g) => g.season?.year != null).map((g) => ({ id: g.id, season: g.season.year }));
    // a degraded board's day is the server's guess, so it gets no "Tonight" reads
    const tonightOn = isFeatureEnabled('bball-hub-tonight', Astro.locals) && !board.degraded;
    const dashboardsOn = isFeatureEnabled('bball-hub-dashboards', Astro.locals);
    const [rows, tonight, dashboards] = await Promise.all([
        games.length ? retrieveGameLines(league, games) : new Map(),
        tonightOn ? prepareTonight(league, board) : undefined,
        dashboardsOn ? prepareDashboards(league, board) : undefined,
    ]);
    const lines: Record<string, HubLine> = {};
    for (const g of board.games) {
        const comp = g.competitions[0];
        const side = (ha: string) => comp.competitors.find((c) => c.homeAway === ha)!;
        const home = side('home'), away = side('away');
        const done = (comp.status ?? g.status)?.type?.completed === true;
        const hs = Number(home.score ?? 0), as = Number(away.score ?? 0);
        const line = hubLine(rows.get(g.id), { home: cleanAbbreviation(home.team), away: cleanAbbreviation(away.team) }, done && hs !== as ? (hs > as ? 'home' : 'away') : null);
        if (line) lines[g.id] = line;
    }
    return { board, lines, index: hubIndex(league), ...(tonight ? { tonight } : {}), ...(dashboards ? { dashboards } : {}) };
}

/**
 * The WAR board is the site's current season (college: the last full one until the site's season turns); "follow a team" is
 * the board's season. A board with no games names no season, so it offers no team to follow.
 */
async function prepareDashboards(league: BasketballLeague, board: BasketballScoreboardParams): Promise<HubDashboards> {
    const seasons = LEAGUES[league].seasons;
    const warSeason = seasons[seasons.length - 1];
    // ponytail: an off day (no games on the board) has no ESPN season, so no follow block; a date-to-season helper if that bites
    const season = board.games.find((g) => g.season?.year != null)?.season.year ?? null;
    const [war, sched] = await Promise.all([retrieveWarLeaders(league, warSeason), season === null ? [] : retrieveFollowSchedule(league, season)]);
    return { warSeason, war: warLeaders(league, war), follow: followTeams(league, sched, board.today) };
}
