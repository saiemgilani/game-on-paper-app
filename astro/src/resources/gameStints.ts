/**
 * BB-G38 ('bball-shot-filters'): the ON/OFF shot filter's reads, sdv-db's game_stints (BB-D32) in the league's season
 * schema, mapped to ESPN athlete ids so the filter names the same players as the page's box. The pros' stints are keyed
 * by stats.nba.com / stats.wnba.com ids: the game through the games schema's schedule_crosswalk (retrieveProGame, the
 * Impact box's own read) and the players through its player_crosswalk. College stints are keyed by the stats.ncaa.org
 * contest and player ids: the contest from ncaa_player_box (the Impact box's own query, so one cache entry) and the
 * players through ncaa_player_crosswalk (BB-D37). Every read is season-filtered and capped, and strict: an outage is never
 * shown as a game with no stints.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { retrieveProGame } from './impactBox';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** The tables are rebuilt once a day (16:00 UTC season products): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A game's stints: ~100 rows (about 20 players a side, a handful each); the cap keeps a bad filter from paging. */
const STINT_LIMIT = '600';
/** One team-season's crosswalk: a roster, plus a row per team for a mid-season mover. */
const ROSTER_LIMIT = '60';

/** One stretch on the floor: the period and its clock (seconds left in the period) at the check-in and the check-out. */
export type Stint = [period: number, clockIn: number, clockOut: number];
/** Each mapped player's stints, keyed by the ESPN athlete id (as a string). A player the crosswalk cannot map is left out. */
export type GameStints = Record<string, Stint[]>;

interface StintRow { player_id: number | string; period: number; clock_in: number; clock_out: number }
const STINT_SELECT = 'player_id,period,clock_in,clock_out';

/** The reads for one ESPN game (`homeId` / `awayId` are the ESPN team ids); {} when the game or its stints are not built. */
export async function retrieveGameStints(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<GameStints> {
    const s = String(season);
    const read = <T>(source: Parameters<typeof retrieveRowsFrom>[0], table: string, q: Record<string, string>) =>
        retrieveRowsFrom<T>(source, table, { season: s, ...q }, TTL, true, NBA_READ_TIMEOUT_MS);
    const pro = PRO_LEAGUES.includes(league);
    let gameId: string;
    if (pro) {
        const x = await retrieveProGame(league, season, espnGameId);
        if (!x) return {};
        gameId = x.gameId;
    } else {
        // the Impact box's query string exactly (impactBox.ts), so both panels share its cache entry
        const box = await read<{ contest_id: string | null }>(leagueSource(league), 'ncaa_player_box', { espn_game_id: espnGameId, select: 'contest_id,player_id,clean_name,player', limit: '80' });
        if (!box[0]?.contest_id) return {};
        gameId = String(box[0].contest_id);
    }
    // the crosswalk's producer-id column: nba_player_id / wnba_player_id, ncaa_player_id in college
    const idCol = pro ? `${league}_player_id` : 'ncaa_player_id';
    const roster = (teamId: number) => read<Record<string, string | number | null>>(BASKETBALL[league].gamesSource, pro ? 'player_crosswalk' : 'ncaa_player_crosswalk',
        { espn_team_id: String(teamId), select: `${idCol},espn_athlete_id`, limit: ROSTER_LIMIT });
    const [stints, home, away] = await Promise.all([
        read<StintRow>(leagueSource(league), 'game_stints', { game_id: gameId, select: STINT_SELECT, limit: STINT_LIMIT }),
        roster(homeId),
        roster(awayId),
    ]);
    // ids compared as strings: the pros' are bigints, college's text
    const espn = new Map([...home, ...away].filter((r) => r[idCol] != null && r.espn_athlete_id != null).map((r) => [String(r[idCol]), String(r.espn_athlete_id)]));
    const out: GameStints = {};
    for (const r of stints) {
        const id = espn.get(String(r.player_id));
        if (id) (out[id] ??= []).push([Number(r.period), Number(r.clock_in), Number(r.clock_out)]);
    }
    return out;
}
