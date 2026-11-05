/**
 * The Data API read behind the player page's Impact panel (BB-G6, behind 'bball-impact'). NBA/WNBA: the games schema's
 * `player_impact` (`nba` / `wnba`, keyed by the stats.nba.com / stats.wnba.com person id, one row per season type): RAPM,
 * adjusted RAPM, SPM, BPM, WAR, BOBAN (BB-D11's `boban_*`; the deprecated `darko_*` aliases are never read) and the
 * possessions behind them. College: `player_value` (`mbb` / `wbb`, keyed by ESPN's athlete id): box BPM and minutes.
 * College RAPM (`ncaa_rapm`, `rapm_within_team`) is keyed by stats.ncaa.org ids the Data API cannot map to ESPN's, so
 * the page does not read it. Every number is the producer's (rule B6); a rank or percentile shows only when the row
 * carries the producer's `<m>_rank` / `<m>_pct`, so the read takes every column (no `select`).
 */
import { retrieveRows, retrieveRowsFrom } from './sdv';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** A player-season is one regular-season row (NBA/WNBA) or one row per team (college); the cap keeps a bad filter from paging. */
const LIMIT = '5';

/** One producer row, as read: the panel picks its columns by name (utils/playerImpact.ts). */
export type PlayerImpactRow = Record<string, unknown>;

/** The player's season rows: the regular season's for the NBA/WNBA (the page's scope), every row in college. */
export function retrievePlayerImpact(league: BasketballLeague, season: number, personId: number): Promise<PlayerImpactRow[]> {
    const q = { season: String(season), player_id: String(personId), limit: LIMIT };
    if (PRO_LEAGUES.includes(league)) {
        return retrieveRowsFrom<PlayerImpactRow>(BASKETBALL[league].gamesSource, 'player_impact', { ...q, season_type: 'Regular Season' }, TTL, true);
    }
    return retrieveRows<PlayerImpactRow>(league, 'player_value', q, TTL, true);
}
