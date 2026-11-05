/**
 * The Data API reads behind BB-G10's scatter views ('bball-impact-scatter', NBA/WNBA): the season's `player_impact` rows
 * (the games schema, `nba` / `wnba`, keyed by the stats.nba.com / stats.wnba.com person id) for the player view's impact
 * axes, and the season's `team_strength` rows (`nba_stats` / `wnba_stats`, keyed by the stats team id) for the team view.
 * One season-wide read each, the same URL for every viewer of a season, so one cache entry. Every number is the
 * producer's; the page plots it as read. Reads are strict, so an outage is never drawn as an empty league.
 */
import { retrieveRows, retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { IMPACT_COLUMNS, TEAM_COLUMNS } from '../nba/scatterMetrics';
import type { BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** An NBA regular season is about 600 player rows, a team table 30; the caps keep a bad filter from paging silently. */
const PLAYER_LIMIT = '1000';
const TEAM_LIMIT = '50';

export type ScatterRow = Record<string, unknown>;

export function retrieveSeasonImpact(league: BasketballLeague, season: number): Promise<ScatterRow[]> {
    const select = ['player_id', ...Object.values(IMPACT_COLUMNS)].join(',');
    const query = { season: String(season), season_type: 'Regular Season', select, limit: PLAYER_LIMIT };
    return retrieveRowsFrom<ScatterRow>(BASKETBALL[league].gamesSource, 'player_impact', query, TTL, true, NBA_READ_TIMEOUT_MS);
}

export function retrieveSeasonTeamStrength(league: BasketballLeague, season: number): Promise<ScatterRow[]> {
    const select = ['team_id', ...Object.values(TEAM_COLUMNS)].join(',');
    return retrieveRows<ScatterRow>(league, 'team_strength', { season: String(season), select, limit: TEAM_LIMIT }, TTL, true);
}
