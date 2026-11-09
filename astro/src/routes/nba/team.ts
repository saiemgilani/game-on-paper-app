import type { AstroGlobal } from 'astro';
import { prepareBasketballTeam, type BasketballTeamParams, type BasketballTeamPrep } from '../basketball/team';
export type NbaTeamParams = BasketballTeamParams;
export type NbaTeamPrep = BasketballTeamPrep;
export const prepareNbaTeam = (Astro: AstroGlobal) => prepareBasketballTeam(Astro, 'nba');
