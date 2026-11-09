import type { AstroGlobal } from 'astro';
import { prepareBasketballScatter, type BasketballScatterParams, type BasketballScatterPrep } from '../basketball/scatter';
export type NbaScatterParams = BasketballScatterParams;
export type NbaScatterPrep = BasketballScatterPrep;
export const prepareNbaScatter = (Astro: AstroGlobal) => prepareBasketballScatter(Astro, 'nba');
