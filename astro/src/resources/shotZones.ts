/**
 * The Data API reads behind the player and team pages' Shot profile (BB-G51, behind 'bball-shot-profile'): sdv-db's
 * `player_shot_zones` / `team_shot_zones` (sdv-db #213, from sportsdataverse-py #1159 BB-D35) in the league's season schema
 * (`nba_stats` / `wnba_stats`, regular season, keyed by the stats.nba.com / stats.wnba.com ids; `mbb` / `wbb`, every game,
 * `team_id` the ESPN id and `player_id` the stats.ncaa.org id). Each zone `z` of rim / mid / corner_3 / above_break_3 has
 * `{z}_fga` / `{z}_fgm` / `{z}_ast` and the rates `{z}_fg_pct` / `{z}_freq` / `{z}_ast_pct`, each with `_n` / `_rank` /
 * `_pct`; team rows add the opponents' under `opp_`. The four zones plus `unlocated_fga` add up to `fga`.
 * The team page also reads its `team_season_rates` rows (the season block's exact query, so one cached response serves
 * both) for the points the scoring split divides. Reads are strict and bounded, so an outage is "unavailable", never "no rows".
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day (16:00 UTC): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A pro has one row per team he played for; the cap keeps a bad filter from paging. */
const PLAYER_LIMIT = '5';
/** A college roster is at most ~20 shooters (one team's rows: the name match runs on them). */
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
