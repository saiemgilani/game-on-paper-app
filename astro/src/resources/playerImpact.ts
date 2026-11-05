/**
 * The Data API read behind the player page's Impact panel (BB-G6, behind 'bball-impact'). NBA/WNBA: the games schema's
 * `player_impact` (`nba` / `wnba`, keyed by the stats.nba.com / stats.wnba.com person id, one row per season type): RAPM,
 * adjusted RAPM, SPM, BPM, WAR, BOBAN (BB-D11's `boban_*`; the deprecated `darko_*` aliases are never read) and the
 * possessions behind them. College: `player_value` (`mbb` / `wbb`, keyed by ESPN's athlete id): box BPM and minutes.
 * College RAPM (`ncaa_rapm`, `rapm_within_team`) is keyed by stats.ncaa.org ids the Data API cannot map to ESPN's, so
 * the page does not read it. Every number is the producer's (rule B6); a rank or percentile shows only when the row
 * carries the producer's `<m>_rank` / `<m>_pct`, so the read takes every column (no `select`).
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { leagueSource, PRO_LEAGUES, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** A player-season is one regular-season row (NBA/WNBA) or one row per team (college); the cap keeps a bad filter from paging. */
const LIMIT = '5';

/** One producer row, as read: the panel picks its columns by name (utils/playerImpact.ts). */
export type PlayerImpactRow = Record<string, unknown>;

/**
 * The player's season rows: the regular season's for the NBA/WNBA (the page's scope), every row in college. Bounded by
 * the game page's read timeout, so a stalled request becomes the panel's "unavailable" line instead of holding the page.
 */
export function retrievePlayerImpact(league: BasketballLeague, season: number, personId: number): Promise<PlayerImpactRow[]> {
    const q = { season: String(season), player_id: String(personId), limit: LIMIT };
    const [source, table, query] = PRO_LEAGUES.includes(league)
        ? [BASKETBALL[league].gamesSource, 'player_impact', { ...q, season_type: 'Regular Season' }]
        : [leagueSource(league), 'player_value', q];
    return retrieveRowsFrom<PlayerImpactRow>(source, table, query, TTL, true, NBA_READ_TIMEOUT_MS);
}
