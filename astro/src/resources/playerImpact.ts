/**
 * The Data API read behind the player page's Impact panel (BB-G6, behind 'bball-impact'). NBA/WNBA: the games schema's
 * `player_impact` (`nba` / `wnba`, keyed by the stats.nba.com / stats.wnba.com person id, one row per season type): RAPM,
 * adjusted RAPM, SPM, BPM, WAR, BOBAN (BB-D11's `boban_*`; the deprecated `darko_*` aliases are never read) and the
 * possessions behind them. College: `player_value` (`mbb` / `wbb`, keyed by ESPN's athlete id): box BPM and minutes,
 * and `ncaa_rapm` (the league-wide RAPM, keyed by the stats.ncaa.org player id): his season's stats.ncaa.org id comes from
 * `ncaa_player_crosswalk` (BB-D37, season-filtered: a new id every season), and a player with no matched pair has box BPM
 * only. Every number is the producer's (rule B6); a rank or percentile shows only when the row carries the producer's
 * `<m>_rank` / `<m>_pct`, so the pro and player_value reads take every column (no `select`).
 */
import { retrieveRowsFrom } from './sdv';
import { retrieveNcaaPlayerId } from './ncaaPlayerCrosswalk';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { leagueSource, PRO_LEAGUES, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** A player-season is one regular-season row (NBA/WNBA) or one row per team (college); the cap keeps a bad filter from paging. */
const LIMIT = '5';

/** One producer row, as read: the panel picks its columns by name (utils/playerImpact.ts). */
export type PlayerImpactRow = Record<string, unknown>;

/** ncaa_rapm's columns the panel reads; selected so its `player_id` (the stats.ncaa.org id) never overwrites the page's. */
const RAPM_SELECT = 'orapm,drapm,rapm_net,off_poss,def_poss';

/**
 * The player's season rows: the regular season's for the NBA/WNBA (the page's scope), every row in college, each carrying
 * his `ncaa_rapm` columns when the crosswalk has his pair. Bounded by the game page's read timeout, so a stalled request
 * becomes the panel's "unavailable" line instead of holding the page. Strict, the crosswalk and RAPM reads included.
 */
export async function retrievePlayerImpact(league: BasketballLeague, season: number, personId: number): Promise<PlayerImpactRow[]> {
    const q = { season: String(season), player_id: String(personId), limit: LIMIT };
    if (PRO_LEAGUES.includes(league)) {
        return retrieveRowsFrom<PlayerImpactRow>(BASKETBALL[league].gamesSource, 'player_impact', { ...q, season_type: 'Regular Season' }, TTL, true, NBA_READ_TIMEOUT_MS);
    }
    const source = leagueSource(league);
    const rapmR = retrieveNcaaPlayerId(source, season, personId, TTL, NBA_READ_TIMEOUT_MS).then((ncaaId) => (ncaaId === null ? []
        : retrieveRowsFrom<PlayerImpactRow>(source, 'ncaa_rapm', { season: String(season), player_id: ncaaId, select: RAPM_SELECT, limit: '1' }, TTL, true, NBA_READ_TIMEOUT_MS)));
    const [rows, [rapm]] = await Promise.all([retrieveRowsFrom<PlayerImpactRow>(source, 'player_value', q, TTL, true, NBA_READ_TIMEOUT_MS), rapmR]);
    if (!rapm) return rows;
    return rows.length ? rows.map((r) => ({ ...r, ...rapm })) : [rapm];
}
