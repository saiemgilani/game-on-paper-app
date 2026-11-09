import type { AstroGlobal } from 'astro';
import { prepareBasketballLeaders, type BasketballLeadersParams, type BasketballLeadersPrep } from '../basketball/leaders';
export type NbaLeadersParams = BasketballLeadersParams;
export type NbaLeadersPrep = BasketballLeadersPrep;
export const prepareNbaLeaders = (Astro: AstroGlobal) => prepareBasketballLeaders(Astro, 'nba');
