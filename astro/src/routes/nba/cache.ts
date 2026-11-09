import { playerCache, seasonCache, unavailable } from '../basketball/cache';
export { setCache, uncacheable } from '../basketball/cache';
export const SEASON_CACHE = seasonCache('nba');
export const PLAYER_CACHE = playerCache('nba');
export const NBA_UNAVAILABLE = (message?: string): Response => unavailable('nba', message);
