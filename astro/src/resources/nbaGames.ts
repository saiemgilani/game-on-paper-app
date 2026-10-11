// Data API reads for one NBA game (the ESPN-keyed `nba` schema) and the processor call.
import { retrieveRowsFrom } from './sdv';
import { requestProcessor, ProcessorError } from './python';
import { NBA_GAMES_SOURCE } from '../utils/league';
import type { DataApiGameRows, NbaProcessorPayload } from './nbaGame';

const YEAR = 60 * 60 * 24 * 365;
const HOUR = 60 * 60;
/** Data API reads fail fast so a slow warehouse degrades the page instead of hanging it. */
export const NBA_READ_TIMEOUT_MS = 8000;
/** A live game's processing can take seconds. */
export const NBA_PROCESSOR_TIMEOUT_MS = 25000;
const SEL = {
    schedule: 'id,date,status_type_name,status_type_completed,status_period,status_display_clock,status_type_detail,venue_full_name,season,format_regulation_periods,home_id,home_abbreviation,home_display_name,home_location,home_name,home_color,home_alternate_color,home_logo,home_score,home_winner,home_linescores,home_records,away_id,away_abbreviation,away_display_name,away_location,away_name,away_color,away_alternate_color,away_logo,away_score,away_winner,away_linescores,away_records',
    pbp: 'id,game_play_number,period_number,clock_display_value,start_game_seconds_remaining,home_score,away_score,team_id,text,type_text,scoring_play,score_value,shooting_play,athlete_id_1,home_team_spread,game_spread_available',
    team_box: 'team_id,team_score,field_goals_made,field_goals_attempted,three_point_field_goals_made,three_point_field_goals_attempted,free_throws_made,free_throws_attempted,offensive_rebounds,defensive_rebounds,total_rebounds,assists,steals,blocks,turnovers,team_turnovers,total_turnovers,fouls,fast_break_points,points_in_paint,largest_lead',
    player_box: 'athlete_id,athlete_display_name,athlete_short_name,athlete_headshot_href,athlete_position_abbreviation,athlete_jersey,team_id,minutes,field_goals_made,field_goals_attempted,three_point_field_goals_made,three_point_field_goals_attempted,free_throws_made,free_throws_attempted,offensive_rebounds,defensive_rebounds,rebounds,assists,steals,blocks,turnovers,fouls,plus_minus,points,starter,ejected,did_not_play,reason',
    play_wp: 'game_play_number,home_win_prob,wp_delta,wp_regime,prior_source,pregame_home_prob,x_legacy,y_legacy',
    game_team_rates: 'team_id,efg_pct,tov_pct,orb_pct,ft_rate,possessions,off_rtg,def_rtg,pace,total_turnovers,game_minutes',
    game_player_rates: 'athlete_id,team_id,ts_pct,usg_pct',
} as const;

type Row = Record<string, any>;

/** Ids reach a URL and a cache key: refuse anything but an ESPN-sized number before either exists. */
function assertGameId(id: string): void {
    if (!/^\d{6,12}$/.test(String(id))) throw new Error(`invalid NBA game id: ${JSON.stringify(id)}`);
}

const isCompleted = (v: unknown) => v === true || v === 'True' || v === 'true';
/** A finished game's schedule row never changes (a year); anything else is re-read hourly. The row says. */
const scheduleTTL = (content: any) => (isCompleted(content?.data?.[0]?.status_type_completed) ? YEAR : HOUR);

// retrieveNbaSchedule and retrieveNbaGameRows read the schedule through this one function: same query,
// same cache key, same TTL rule, so neither can pin the other's entry at a different lifetime.
const readSchedule = (id: string) =>
    retrieveRowsFrom<Row>(NBA_GAMES_SOURCE, 'schedule', { id, select: SEL.schedule, limit: '1' }, scheduleTTL, true, NBA_READ_TIMEOUT_MS);

export async function retrieveNbaSchedule(id: string): Promise<Row | null> {
    assertGameId(id);
    return (await readSchedule(id))[0] ?? null;
}

/** All seven tables for a completed game, in parallel, strict (a failed read rejects the whole thing). */
export async function retrieveNbaGameRows(id: string): Promise<DataApiGameRows> {
    assertGameId(id);
    const q = (extra: Record<string, string> = {}) => ({ game_id: id, limit: '5000', ...extra });
    const get = (table: keyof typeof SEL, query: Record<string, string>) =>
        retrieveRowsFrom<Row>(NBA_GAMES_SOURCE, table, query, YEAR, true, NBA_READ_TIMEOUT_MS);
    const [schedule, pbp, team_box, player_box, play_wp, game_team_rates, game_player_rates] = await Promise.all([
        readSchedule(id),
        get('pbp', q({ select: SEL.pbp, order: 'game_play_number' })),
        get('team_box', q({ select: SEL.team_box })),
        get('player_box', q({ select: SEL.player_box })),
        get('play_wp', q({ select: SEL.play_wp, order: 'game_play_number' })),
        get('game_team_rates', q({ select: SEL.game_team_rates })),
        get('game_player_rates', q({ select: SEL.game_player_rates })),
    ]);
    return { schedule, pbp, team_box, player_box, play_wp, game_team_rates, game_player_rates };
}

/** The processor's payload; a non-2xx (404 = not started / no plays, 5xx = degraded) or a timeout throws `ProcessorError`. */
export async function retrieveNbaProcessedGame(id: string, cacheTTL: number): Promise<NbaProcessorPayload> {
    assertGameId(id);
    const json = JSON.parse(await requestProcessor(`nba/${id}/process`, cacheTTL, '', NBA_PROCESSOR_TIMEOUT_MS));
    if (json?.status === 'bad' || !Array.isArray(json?.plays)) throw new ProcessorError(502, `processor: ${json?.message ?? 'no plays'} for ${id}`);
    return json as NbaProcessorPayload;
}
