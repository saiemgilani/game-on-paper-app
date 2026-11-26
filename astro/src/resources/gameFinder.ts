/**
 * The basketball game finder's read (BB-G57): sdv-db's `/v1/<league>/game_finder` (BB-D41) over the league's ESPN-keyed
 * player_box / team_box. Every count is the route's: `count` (every matching game), `entities` and the games-per-player (or
 * per-team) `counts`; `data` holds the first rows only.
 */
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';
import { retrieveBodyFrom } from './sdv';

export interface FinderRow {
    game_id: number;
    season: number;
    season_type: number;
    game_date: string;
    team_id: number;
    team_abbreviation: string | null;
    team_display_name: string | null;
    team_winner: boolean | null;
    team_score: number | null;
    opponent_team_id: number;
    opponent_team_abbreviation: string | null;
    opponent_team_score: number | null;
    home_away: 'home' | 'away' | null;
    /** player unit only */
    athlete_id?: number;
    athlete_display_name?: string | null;
    starter?: boolean | null;
    [stat: string]: unknown;
}

export interface FinderCount { id: number; name: string | null; games: number }

export interface FinderBody {
    league: BasketballLeague;
    unit: 'player' | 'team';
    count: number;
    entities: number;
    counts: FinderCount[];
    data: FinderRow[];
}

/** The route answers in well under a second over a season; a wide range scans more, so past this the page says unavailable. */
export const FINDER_TIMEOUT_MS = 15_000;
/** The boxes move with the nightly ingest. */
const TTL = 60 * 60;

export function retrieveGameFinder(league: BasketballLeague, query: Record<string, string>): Promise<FinderBody> {
    return retrieveBodyFrom<FinderBody>(BASKETBALL[league].gamesSource, 'game_finder', query, TTL, FINDER_TIMEOUT_MS);
}
