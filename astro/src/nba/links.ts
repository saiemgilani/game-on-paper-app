import { DateTime } from 'luxon';
import { BASKETBALL, hasTeamPages } from '../basketball/config';
import { LEAGUES, leaguePath, type BasketballLeague } from '../utils/league';
import { parseDateParam } from './scoreboard';

/** Public league URLs. The current season has no ?season= so links land on the cached canonical URL. */
export function seasonQuery(season: number, current: number): string {
    return season === current ? '' : `?season=${season}`;
}

export const playerHref = (personId: number, q: string, league: BasketballLeague = 'nba') => `${leaguePath(league, `/players/${personId}`)}${q}`;
export const teamHref = (teamId: number, q: string, league: BasketballLeague = 'nba') => `${leaguePath(league, `/team/${teamId}`)}${q}`;
export const gameHref = (league: BasketballLeague, gameId: string | number) => leaguePath(league, `/game/${gameId}`);

/** `path?params`, leaving out any param equal to its default (so defaults map to the canonical URL). */
export function withParams(path: string, params: Record<string, string>, defaults: Record<string, string> = {}): string {
    const kept = Object.entries(params).filter(([k, v]) => v !== defaults[k]);
    return kept.length ? `${path}?${new URLSearchParams(kept)}` : path;
}

/**
 * /<league>/team/<team key> for an ESPN team object ({id}); null for a team the league's team module does not know.
 * Outside the NBA the game's `season` rides along (a listed season only), so a 2005 Detroit Shock game links to Dallas's
 * franchise page for 2005 and a 2002 Fire game (ESPN 132052) to 1611661327's 2002 page, the 2000-02 Fire. The NBA's
 * link stays season-less, as before.
 */
export function teamHrefFromEspn(t: { id?: unknown } | null | undefined, league: BasketballLeague = 'nba', season?: number | null): string | null {
    if (!hasTeamPages(league)) return null; // no team pages yet (a league whose menu has no /teams): plain team names, never a 404 link
    const team = BASKETBALL[league].teams.byEspnId(Number(t?.id));
    if (!team) return null;
    const seasons = LEAGUES[league].seasons;
    const q = league !== 'nba' && season != null && seasons.includes(season) ? seasonQuery(season, seasons[seasons.length - 1]) : '';
    return teamHref(team.team_id, q, league);
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
