import { DateTime } from 'luxon';
import { BASKETBALL } from '../basketball/config';
import { leaguePath, type BasketballLeague } from '../utils/league';
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

/** /<league>/team/<team key> for an ESPN team object ({id}); null for a team the league's team module does not know. */
export function teamHrefFromEspn(t: { id?: unknown } | null | undefined, league: BasketballLeague = 'nba'): string | null {
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
