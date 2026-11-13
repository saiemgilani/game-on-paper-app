/**
 * The Data API reads behind the player and team pages' Shot profile (BB-G51, behind 'bball-shot-profile'): sdv-db's
 * `player_shot_zones` / `team_shot_zones` (sdv-db #213, from sportsdataverse-py #1159 BB-D35) in the league's season schema
 * (`nba_stats` / `wnba_stats`, regular season, keyed by the stats.nba.com / stats.wnba.com ids; `mbb` / `wbb`, every game,
 * `team_id` the ESPN id and `player_id` the stats.ncaa.org id). Each zone `z` of rim / mid / corner_3 / above_break_3 has
 * `{z}_fga` / `{z}_fgm` / `{z}_ast` and the rates `{z}_fg_pct` / `{z}_freq` / `{z}_ast_pct`, each with `_n` / `_rank` /
 * `_pct`; team rows add the opponents' under `opp_`. The four zones plus `unlocated_fga` add up to `fga`.
 * The team page also reads its `team_season_rates` rows (the season block's exact query, so one cached response serves
 * both) for the points the scoring split divides; the player page reads his season FGM and FTM from `player_season_stats`
 * (the split's free throws). Reads are strict and bounded, so an outage is "unavailable", never "no rows".
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { leagueSource, type BasketballLeague } from '../utils/league';
import { numberOrNull } from '../utils/misc';

/** The season products move once a day (16:00 UTC): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A pro has one row per team he played for; the cap keeps a bad filter from paging. */
const PLAYER_LIMIT = '5';
/** A college roster is at most ~20 shooters (one team's rows: the crosswalk id picks his). */
const ROSTER_LIMIT = '40';

export const ZONE_KEYS = ['rim', 'mid', 'corner_3', 'above_break_3'] as const;
export type ZoneKey = (typeof ZONE_KEYS)[number];

/** One zone table row: the counts, every rate with its `_n` / `_rank` / `_pct`, and (team rows) the same under `opp_`. */
export type ShotZoneRow = {
    season: number;
    team_id: number;
    /** player rows only: the pros' stats id (bigint), college's stats.ncaa.org id (text) */
    player_id?: number | string;
    /** player rows only: the NBA's is the family name only; the page names him from its own rows */
    player_name?: string | null;
    games: number | null;
    fga: number | null;
    fgm: number | null;
    unlocated_fga: number | null;
} & Record<string, number | string | null | undefined>;

/** The `team_season_rates` columns the scoring split uses (the read itself is the season block's: every column). */
export interface TeamPointsRow { split: string; games: number | null; pts: number | null; opp_pts: number | null }

export interface TeamZoneReads { zones: ShotZoneRow | null; rates: TeamPointsRow[] }

const read = <T>(league: BasketballLeague, table: string, query: Record<string, string>) =>
    retrieveRowsFrom<T>(leagueSource(league), table, query, TTL, true, NBA_READ_TIMEOUT_MS);

/** NBA/WNBA: his rows (one per team) by stats id. */
export function retrievePlayerShotZones(league: BasketballLeague, season: number, personId: number): Promise<ShotZoneRow[]> {
    return read<ShotZoneRow>(league, 'player_shot_zones', { season: String(season), player_id: String(personId), limit: PLAYER_LIMIT });
}

/**
 * College: his season's stats.ncaa.org id from `ncaa_player_crosswalk` (BB-D37), the id `player_shot_zones` keys players by;
 * null when the crosswalk has no matched pair. Season-filtered: stats.ncaa.org issues a new id every season.
 * `ncaa_player_id` is text, `espn_athlete_id` a bigint: compared as strings. The query is #408's
 * resources/ncaaPlayerCrosswalk.ts's key for key, so one cached response serves both.
 * ponytail: inline until #408 merges, then switch to that module's retrieveNcaaPlayerId.
 */
export async function retrieveNcaaPlayerId(league: BasketballLeague, season: number, espnAthleteId: number): Promise<string | null> {
    const [x] = await read<{ ncaa_player_id: string | null }>(league, 'ncaa_player_crosswalk',
        { season: String(season), espn_athlete_id: String(espnAthleteId), select: 'ncaa_player_id', limit: PLAYER_LIMIT });
    return x?.ncaa_player_id ? String(x.ncaa_player_id) : null;
}

/** His season's field-goal and free-throw makes, as the season stats carry them: the player split's free throws (Q13). */
export interface SeasonFt { fgm: number; ftm: number }

/**
 * The pros' `player_season_stats` (stats.nba.com / stats.wnba.com ids): one regular-season totals row of the base measure,
 * the zone table's scope. ponytail: the two schemas spell these values differently; one map until the producer agrees.
 */
const PRO_TOTALS: Record<'nba' | 'wnba', Record<string, string>> = {
    nba: { season_type: 'regular-season', per_mode: 'totals', measure_type: 'base' },
    wnba: { season_type: 'Regular Season', per_mode: 'Totals', measure_type: 'Base' },
};
/** College's ESPN `player_season_stats` is long; its totals' made-attempted stats carry the counts in `display_value` ("83-111", `value` null). */
const MADE = { fgm: 'fieldGoalsMade-fieldGoalsAttempted', ftm: 'freeThrowsMade-freeThrowsAttempted' } as const;
const madeOf = (v: unknown) => { const m = /^(\d+)-\d+$/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };

/**
 * His season FGM and FTM: the pros' totals row by stats id, college's season totals by ESPN athlete id (the page's own).
 * Null when there is no such row, or more than one (never added up).
 */
export async function retrieveSeasonFt(league: BasketballLeague, season: number, personId: number): Promise<SeasonFt | null> {
    const s = String(season), id = String(personId);
    let fgm: number | null, ftm: number | null;
    if (league === 'nba' || league === 'wnba') {
        const rows = await read<{ fgm: unknown; ftm: unknown }>(league, 'player_season_stats', { season: s, player_id: id, ...PRO_TOTALS[league], select: 'player_id,fgm,ftm', limit: PLAYER_LIMIT });
        if (rows.length !== 1) return null;
        [fgm, ftm] = [numberOrNull(rows[0].fgm), numberOrNull(rows[0].ftm)];
    } else {
        const rows = await retrieveRowsFrom<{ stat_name: string; display_value: unknown }>(BASKETBALL[league].gamesSource, 'player_season_stats',
            { season: s, athlete_id: id, category: 'totals', select: 'athlete_id,stat_name,display_value', limit: '20' }, TTL, true, NBA_READ_TIMEOUT_MS);
        const one = (stat: string) => { const hit = rows.filter((r) => r.stat_name === stat); return hit.length === 1 ? madeOf(hit[0].display_value) : null; };
        [fgm, ftm] = [one(MADE.fgm), one(MADE.ftm)];
    }
    return fgm == null || ftm == null ? null : { fgm, ftm };
}

/** College: every shooter of his ESPN team (the table keys players by the stats.ncaa.org id, the page by ESPN's). */
export function retrieveTeamPlayerShotZones(league: BasketballLeague, season: number, teamId: number): Promise<ShotZoneRow[]> {
    return read<ShotZoneRow>(league, 'player_shot_zones', { season: String(season), team_id: String(teamId), limit: ROSTER_LIMIT });
}

/** The team's zone row and its season rates rows, in parallel. `teamId` keys both (the stats id for the pros, ESPN's in college). */
export async function retrieveTeamShotZones(league: BasketballLeague, season: number, teamId: number): Promise<TeamZoneReads> {
    const s = String(season);
    const [zones, rates] = await Promise.all([
        read<ShotZoneRow>(league, 'team_shot_zones', { season: s, team_id: String(teamId), limit: '1' }),
        // resources/teamSeason.ts's query, key for key in its order, so the KV cache answers both
        read<TeamPointsRow>(league, 'team_season_rates', { season: s, team_id: String(teamId), limit: '10' }),
    ]);
    return { zones: zones[0] ?? null, rates };
}
