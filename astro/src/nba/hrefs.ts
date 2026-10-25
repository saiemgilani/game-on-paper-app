import type { BasketballLeague } from '../utils/league';

// Client-safe basketball URLs: no runtime import, so an island (Leaderboards) does not ship the league config.
// leaguePath reads LEAGUES, which pulls constants into the bundle (+34 KB, self-review on #324). Every basketball
// league's prefix is `/<league>`; test/basketball/links.test.ts pins basketballPath to leaguePath for each one.
export const basketballPath = (league: BasketballLeague, path: string) => (path === '/' ? `/${league}` : `/${league}${path}`);

/** Public league URLs. The current season has no ?season= so links land on the cached canonical URL. */
export function seasonQuery(season: number, current: number): string {
    return season === current ? '' : `?season=${season}`;
}

export const playerHref = (personId: number, q: string, league: BasketballLeague) => `${basketballPath(league, `/players/${personId}`)}${q}`;
export const teamHref = (teamId: number, q: string, league: BasketballLeague) => `${basketballPath(league, `/team/${teamId}`)}${q}`;
export const gameHref = (league: BasketballLeague, gameId: string | number) => basketballPath(league, `/game/${gameId}`);

/** `path?params`, leaving out any param equal to its default (so defaults map to the canonical URL). */
export function withParams(path: string, params: Record<string, string>, defaults: Record<string, string> = {}): string {
    const kept = Object.entries(params).filter(([k, v]) => v !== defaults[k]);
    return kept.length ? `${path}?${new URLSearchParams(kept)}` : path;
}
