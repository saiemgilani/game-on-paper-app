import type { AstroGlobal } from 'astro';
import { readBasketballSeasonRows } from '../basketball/season';
export const readSeasonRows = (Astro: AstroGlobal, season: number, route: string, cacheOnSuccess = true) => readBasketballSeasonRows(Astro, 'nba', season, route, cacheOnSuccess);
