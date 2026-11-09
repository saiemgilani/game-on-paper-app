import type { AstroGlobal } from 'astro';
import { prepareBasketballTeams, type BasketballTeamsParams, type BasketballTeamsPrep } from '../basketball/teams';
export type NbaTeamsParams = BasketballTeamsParams;
export type NbaTeamsPrep = BasketballTeamsPrep;
export const prepareNbaTeams = (Astro: AstroGlobal) => prepareBasketballTeams(Astro, 'nba');
