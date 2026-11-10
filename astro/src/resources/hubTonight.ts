/**
 * The Data API reads behind the league hub's "Tonight" (BB-G48, behind 'bball-hub-tonight'): a day's top player_box lines for
 * the standouts and each final's play_wp for its card's sparkline, from the league's ESPN-keyed games schema. Lenient like the
 * hub's line read: a failed read is a section or a sparkline left out, never a hub that does not render.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { MAX_LINE_READS } from './gameLines';
import { BASKETBALL } from '../basketball/config';
import type { StandoutBoxRow } from '../basketball/hub';
import type { BasketballLeague } from '../utils/league';

/** Nightly tables; the cache key also carries the table's ingest stamp, so a new ingest is a new read. */
const TTL = 6 * 60 * 60;
const BOX = 'game_id,athlete_id,athlete_display_name,team_id,team_abbreviation,opponent_team_abbreviation,minutes,points,field_goals_made,field_goals_attempted,free_throws_made,free_throws_attempted,offensive_rebounds,defensive_rebounds,rebounds,assists,steals,blocks,turnovers,fouls';
// ponytail: the day's top scorers stand in for "every line" (an all-D-I day is ~4,000 rows and game score is not an API column);
// a top-5 game score from outside the top 200 scorers is a 15-and-15 night on a full college slate. A game_score column if it matters.
export const STANDOUT_CANDIDATES = 200;

/** A day's player_box lines, its top scorers first. Empty for a day the nightly has not ingested yet. */
export async function retrieveDayBox(league: BasketballLeague, season: number, day: string): Promise<StandoutBoxRow[]> {
    return retrieveRowsFrom<StandoutBoxRow>(BASKETBALL[league].gamesSource, 'player_box',
        { season: String(season), game_date: day, select: BOX, order: '-points', limit: String(STANDOUT_CANDIDATES) }, TTL, false, NBA_READ_TIMEOUT_MS)
        .catch(() => []);
}

/** ESPN game id -> its home win probability by play, for the finals the nightly has ingested (the hub's first MAX_LINE_READS). */
export async function retrieveFinalsWp(league: BasketballLeague, games: readonly { id: string; season: number }[]): Promise<Map<string, (number | null)[]>> {
    const src = BASKETBALL[league].gamesSource;
    const got = await Promise.all(games.slice(0, MAX_LINE_READS).map(async ({ id, season }) => {
        const r = await retrieveRowsFrom<{ home_win_prob: number | null }>(src, 'play_wp',
            { season: String(season), game_id: id, select: 'game_play_number,home_win_prob', order: 'game_play_number', limit: '2000' }, TTL, false, NBA_READ_TIMEOUT_MS)
            .catch(() => []);
        return [id, r.map((x) => x.home_win_prob)] as const;
    }));
    return new Map(got.filter(([, wp]) => wp.length > 0));
}
