/**
 * The Data API read behind the player page's Season vs Current panel (BB-G56, behind 'bball-current-impact'), NBA only:
 * the games schema's `current_impact` (BB-D39), one row per player per `as_of` date (opening night, then every 7 days),
 * keyed by the stats.nba.com person id. Current impact is his expected impact as of that date, from games before it; the
 * page reads the season's latest `as_of` row. Season impact (BB-D38's `reml_rapm` trio) rides on the `player_impact` row
 * the Impact panel already reads (resources/playerImpact.ts). Every number is the producer's (rule B6).
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';

/** The ratings move once a week: the season pages' window is plenty. */
const TTL = 6 * 60 * 60;
/** The first season BB-D38 / BB-D39 build (2006-07). */
export const CURRENT_IMPACT_FIRST_SEASON = 2007;

/** Whether the league and season have the two ratings at all: the NBA from 2006-07. Anything else spends no read. */
export const hasCurrentImpact = (league: BasketballLeague, season: number) => league === 'nba' && season >= CURRENT_IMPACT_FIRST_SEASON;

export interface CurrentImpactRow {
    player_id: number;
    season: number;
    /** the rating's date: it uses only games before it */
    as_of: string;
    o_current_impact: number | null;
    d_current_impact: number | null;
    current_impact: number | null;
    o_prior: number | null;
    d_prior: number | null;
    /** this season's possessions before `as_of` (0 on opening night) */
    off_poss: number | null;
    def_poss: number | null;
    /** his last game before `as_of`, possibly last season's */
    last_game_date: string | null;
}

/** His latest `as_of` row of the season (none before the season's first build). Call only when hasCurrentImpact. */
export function retrieveCurrentImpact(league: BasketballLeague, season: number, personId: number): Promise<CurrentImpactRow[]> {
    return retrieveRowsFrom<CurrentImpactRow>(BASKETBALL[league].gamesSource, 'current_impact',
        { season: String(season), player_id: String(personId), order: '-as_of', limit: '1' }, TTL, true, NBA_READ_TIMEOUT_MS);
}
