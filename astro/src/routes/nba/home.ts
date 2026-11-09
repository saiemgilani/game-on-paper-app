import type { AstroGlobal } from 'astro';
import { prepareBasketballHome, type BasketballHomeParams, type BasketballHomePrep } from '../basketball/home';
import { resolveBasketballSeason } from '../basketball/season';
export type NbaHomeParams = BasketballHomeParams;
export type NbaHomePrep = BasketballHomePrep;
export const resolveSeason = (Astro: AstroGlobal) => resolveBasketballSeason(Astro, 'nba');
export const prepareNbaHome = (Astro: AstroGlobal) => prepareBasketballHome(Astro, 'nba');
