/**
 * The Data API reads behind the player page's Career panel (BB-G54, behind 'bball-career'): every season of his in the same
 * two producer tables the season panels read one season of.
 * - `player_war` (the league's season schema, all four leagues; resources/playerWar.ts): rating, WAR and VORP, with the
 *   producer's `war_` / `vorp_` `_rank`, `_pct` and `_n`;
 * - `player_impact` (the pros' games schema, regular season; resources/playerImpact.ts): RAPM and BPM with the same suffixes.
 *   College has no career impact read: its panel waits for BB-D16's crosswalk (utils/playerImpact.ts COLLEGE_IMPACT).
 * One read each per player, the league's whole season range (a season filter, so the read stays bounded), cached apart from
 * any one season page. Strict and bounded by the game page's read timeout, like the season panels' reads.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import type { PlayerImpactRow } from './playerImpact';
import type { PlayerWarRow } from './playerWar';
import { BASKETBALL } from '../basketball/config';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** One row per player-season and the NBA's longest range is 29 seasons; the cap keeps a bad filter from paging. */
const LIMIT = '40';

const range = (first: number, last: number, personId: number) =>
    ({ season__gte: String(first), season__lte: String(last), player_id: String(personId) });

/** His `player_war` rows, every season from `first` to `last`, every column. */
export function retrievePlayerWarCareer(league: BasketballLeague, first: number, last: number, personId: number): Promise<PlayerWarRow[]> {
    return retrieveRowsFrom<PlayerWarRow>(leagueSource(league), 'player_war', { ...range(first, last, personId), limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
}

/** His regular-season `player_impact` rows (NBA/WNBA only), every season from `first` to `last`, every column. */
export function retrievePlayerImpactCareer(league: 'nba' | 'wnba', first: number, last: number, personId: number): Promise<PlayerImpactRow[]> {
    return retrieveRowsFrom<PlayerImpactRow>(BASKETBALL[league].gamesSource, 'player_impact',
        { ...range(first, last, personId), season_type: 'Regular Season', limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
}
