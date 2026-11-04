/**
 * The Data API reads behind /<league>/best-games (BB-G29): sdv-db's `{lg}.game_excitement` (sdv-db #185, sdv-py
 * season_game_excitement: one row per game, its GEI, lead changes and biggest WP swing, ranked within the season) and the
 * season's `{lg}.schedule` for each game's day, teams and score. Both live in the ESPN-keyed game schema
 * (BASKETBALL[league].gamesSource), so `game_excitement.game_id` is `schedule.id`. Every number is the producer's; the
 * page joins, filters and orders. Reads are strict, so an outage (503) is never mistaken for an empty season.
 */
import { retrieveRowsFrom } from './sdv';
import { BASKETBALL } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';

/** Both tables follow the nightly ingest: the season pages' window. */
const TTL = 6 * 60 * 60;
/** A men's college season is ~6,300 games; the API's own cap, so a full season is one read. */
const LIMIT = '50000';

export interface GameExcitementRow {
    game_id: number;
    season: number;
    gei: number | null;
    lead_changes: number | null;
    /** the largest single-play home WP change the index sums, in percentage points */
    max_swing_pts: number | null;
    completed: boolean | null;
    /** 1 = the season's most exciting completed game; ties share the best rank */
    gei_rank: number | null;
    /** the share of the season's completed games at or below this GEI */
    gei_pct: number | null;
    /** the season's completed games */
    gei_n: number | null;
}

export interface BestGameScheduleRow {
    id: number;
    game_date: string | null;
    /** 2 regular season, 3 postseason (ESPN) */
    season_type: number | null;
    home_id: number | null;
    home_display_name: string | null;
    home_abbreviation: string | null;
    home_score: number | null;
    away_id: number | null;
    away_display_name: string | null;
    away_abbreviation: string | null;
    away_score: number | null;
    notes_headline: string | null;
}

const SCHEDULE_COLUMNS = 'id,game_date,season_type,home_id,home_display_name,home_abbreviation,home_score,away_id,away_display_name,away_abbreviation,away_score,notes_headline';
const GEI_COLUMNS = 'game_id,season,gei,lead_changes,max_swing_pts,completed,gei_rank,gei_pct,gei_n';

async function read<T>(league: BasketballLeague, table: string, query: Record<string, string>): Promise<T[]> {
    const rows = await retrieveRowsFrom<T>(BASKETBALL[league].gamesSource, table, { ...query, limit: LIMIT }, TTL, true);
    if (rows.length >= Number(LIMIT)) throw new Error(`${table} reached the ${LIMIT}-row cap: the read is truncated`);
    return rows;
}

/** The season's completed games with a GEI, and its schedule (one cached read each, whatever the page's filters). */
export async function retrieveBestGamesSeason(league: BasketballLeague, season: number): Promise<{ excitement: GameExcitementRow[]; schedule: BestGameScheduleRow[] }> {
    const [excitement, schedule] = await Promise.all([
        read<GameExcitementRow>(league, 'game_excitement', { season: String(season), completed: 'true', select: GEI_COLUMNS }),
        read<BestGameScheduleRow>(league, 'schedule', { season: String(season), select: SCHEDULE_COLUMNS }),
    ]);
    return { excitement, schedule };
}
