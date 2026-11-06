import { DateTime } from 'luxon';
import { BASKETBALL } from '../basketball/config';
import { leaguePath, type BasketballLeague } from '../utils/league';
import { parseDateParam } from './scoreboard';
import { teamHref } from './hrefs';

// The pure helpers live in ./hrefs so an island can import them without this module's config/luxon imports.
export { seasonQuery, playerHref, teamHref, gameHref, withParams } from './hrefs';

/** /<league>/team/<team key> for an ESPN team object ({id}); null for a team the league's team module does not know. */
export function teamHrefFromEspn(t: { id?: unknown } | null | undefined, league: BasketballLeague): string | null {
    const team = BASKETBALL[league].teams.byEspnId(Number(t?.id));
    return team ? teamHref(team.team_id, '', league) : null;
}

/** The scoreboard day a game belongs to (its tip in the league's scoreboard zone), or the bare scoreboard when out of range. */
export function scoreboardDayHref(league: BasketballLeague, gameDate: string | null | undefined, today?: string): string {
    const cfg = BASKETBALL[league];
    const now = today ?? DateTime.now().setZone(cfg.scoreboardTimeZone).toISODate()!;
    const day = gameDate ? DateTime.fromISO(gameDate).setZone(cfg.scoreboardTimeZone).toISODate() : null;
    const base = leaguePath(league, '/scoreboard');
    return day && parseDateParam(day, now, cfg.firstScoreboardDay).ok ? `${base}?date=${day}` : base;
}
