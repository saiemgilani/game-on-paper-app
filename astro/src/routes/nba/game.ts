import type { AstroGlobal } from 'astro';
import { prepareBasketballGame, type BasketballGamePrep } from '../basketball/game';
export { sanityGate } from '../basketball/game';
export type NbaGamePrep = BasketballGamePrep;
export const prepareNbaGame = (Astro: AstroGlobal) => prepareBasketballGame(Astro, 'nba');
