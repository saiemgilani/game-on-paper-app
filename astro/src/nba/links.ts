import { DateTime } from 'luxon';
import { BASKETBALL, hasTeamPages } from '../basketball/config';
import { LEAGUES, leaguePath, type BasketballLeague } from '../utils/league';
import { parseDateParam } from './scoreboard';
import { seasonQuery, teamHref } from './hrefs';

// The pure helpers live in ./hrefs so an island can import them without this module's config/luxon imports.
export { seasonQuery, playerHref, teamHref, gameHref, withParams } from './hrefs';

/**
 * /<league>/team/<team key> for an ESPN team object ({id}); null for a team the league's team module does not know.
 * Outside the NBA the game's `season` rides along (a listed season only), so a 2005 Detroit Shock game links to Dallas's
 * franchise page for 2005 and a 2002 Fire game (ESPN 132052) to 1611661327's 2002 page, the 2000-02 Fire. The NBA's
 * link stays season-less, as before. A league with a membership table (college, D48/R8) links only a page that answers
 * 200: see collegeTeamHref.
 */
export function teamHrefFromEspn(t: { id?: unknown } | null | undefined, league: BasketballLeague, season?: number | null): string | null {
    if (!hasTeamPages(league)) return null; // no team pages yet (a league whose menu has no /teams): plain team names, never a 404 link
    if (BASKETBALL[league].currentMembers) return collegeTeamHref(Number(t?.id), league, season);
    const team = BASKETBALL[league].teams.byEspnId(Number(t?.id));
    if (!team) return null;
    const seasons = LEAGUES[league].seasons;
    const q = league !== 'nba' && season != null && seasons.includes(season) ? seasonQuery(season, seasons[seasons.length - 1]) : '';
    return teamHref(team.team_id, q, league);
}

/**
 * D48 (R8, rulings R-P2/R-P3): a college team page is a 404 for a season's non-member, so a game links only a member's page.
 * A shot-dashboard season (from shotFirstSeason, not the current one) links that season's page when the team was a member
 * (memberSeasons; a departed program resolves through inSeason). The current season, no season, or a season before the
 * dashboards (whose ?season= would 404): a current member's current page, anyone else plain text.
 */
function collegeTeamHref(id: number, league: BasketballLeague, season: number | null | undefined): string | null {
    const cfg = BASKETBALL[league];
    const members = cfg.currentMembers!;
    const seasons = LEAGUES[league].seasons;
    const pastSeason = season != null && season !== members.season && season >= (cfg.shotFirstSeason ?? seasons[0]) && seasons.includes(season);
    if (!pastSeason) return members.ids.includes(id) ? teamHref(id, '', league) : null; // ponytail: 365-id scan, a Set if a page links thousands
    const team = cfg.teams.byEspnId(id) ?? cfg.teams.inSeason(id, season);
    const table = cfg.memberSeasons;
    if (!team || (table && season <= table.through && !(table.seasons.get(team.team_id) ?? []).includes(season))) return null;
    return teamHref(team.team_id, seasonQuery(season, seasons[seasons.length - 1]), league);
}

/** The scoreboard day a game belongs to (its tip in the league's scoreboard zone), or the bare scoreboard when out of range. */
export function scoreboardDayHref(league: BasketballLeague, gameDate: string | null | undefined, today?: string): string {
    const cfg = BASKETBALL[league];
    const now = today ?? DateTime.now().setZone(cfg.scoreboardTimeZone).toISODate()!;
    const day = gameDate ? DateTime.fromISO(gameDate).setZone(cfg.scoreboardTimeZone).toISODate() : null;
    const base = leaguePath(league, '/scoreboard');
    // a college game is on its day's all-D-I board, not necessarily on the default Top 25 one (plan #8 Decision 10)
    const all = cfg.scoreboardGroups ? '&group=all' : '';
    return day && parseDateParam(day, now, cfg.firstScoreboardDay).ok ? `${base}?date=${day}${all}` : base;
}
