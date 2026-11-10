/**
 * College player ids: mbb/wbb `ncaa_player_crosswalk` (BB-D37) maps the stats.ncaa.org player id the stats.ncaa.org
 * tables are keyed by to the ESPN athlete id the player pages are keyed by. stats.ncaa.org issues a new id every season,
 * so every read is season-filtered (season = the ending year, the college pages' own). Only matched pairs are served.
 * `ncaa_player_id` is text and `espn_athlete_id` a bigint: both are compared as strings.
 *
 * ponytail: one helper for one player's id (BB-G6). #443 (game logs) reads the same row inline and #411 / #403 read a
 * team's pairs; they can switch to this module once it merges.
 */
import { retrieveRowsFrom } from './sdv';
import type { SdvSource } from '../utils/league';

/** One athlete-season is one pair (two for a mid-season transfer); the cap keeps a bad filter from paging. */
const LIMIT = '5';

/**
 * His season's stats.ncaa.org id, or null when the crosswalk has no matched pair. Strict: an outage rejects instead of
 * reading as "no pair". ponytail: the first pair; a mid-season transfer's other team's id is not read.
 */
export async function retrieveNcaaPlayerId(source: SdvSource, season: number, espnAthleteId: number | string, ttl: number, timeoutMs?: number): Promise<string | null> {
    const [x] = await retrieveRowsFrom<{ ncaa_player_id: string | null }>(source, 'ncaa_player_crosswalk',
        { season: String(season), espn_athlete_id: String(espnAthleteId), select: 'ncaa_player_id', limit: LIMIT }, ttl, true, timeoutMs);
    return x?.ncaa_player_id ? String(x.ncaa_player_id) : null;
}
