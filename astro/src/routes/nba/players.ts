import type { AstroGlobal } from 'astro';
import { prepareBasketballPlayers, type BasketballPlayersParams, type BasketballPlayersPrep } from '../basketball/players';
export type NbaPlayersParams = BasketballPlayersParams;
export type NbaPlayersPrep = BasketballPlayersPrep;
export const prepareNbaPlayers = (Astro: AstroGlobal) => prepareBasketballPlayers(Astro, 'nba');
