import type { AstroGlobal } from 'astro';
import { prepareBasketballPlayer, type BasketballPlayerParams, type BasketballPlayerPrep } from '../basketball/player';
export type NbaPlayerParams = BasketballPlayerParams;
export type NbaPlayerPrep = BasketballPlayerPrep;
export const prepareNbaPlayer = (Astro: AstroGlobal) => prepareBasketballPlayer(Astro, 'nba');
