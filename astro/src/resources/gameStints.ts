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
import { retrieveGamePlayerImpact, retrieveProGame } from './impactBox';
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

/** One stint row as read: its clock and, for BB-G36's shift chart, the producer's points and possessions while on. */
export interface StintRow {
    player_id: number | string; period: number; clock_in: number; clock_out: number
    seconds: number | null; poss: number | null; opp_poss: number | null; pts: number | null; opp_pts: number | null; plus_minus: number | null
}
// one select for both readers (these shot filters and BB-G36's shift chart): the two panels share one cache entry
const STINT_SELECT = 'player_id,period,clock_in,clock_out,seconds,poss,opp_poss,pts,opp_pts,plus_minus';
/** A stint row mapped to its player's ESPN athlete id and side (the crosswalk read that mapped him). */
export interface MappedStint extends StintRow { espn: string; side: 'home' | 'away' }

/** The reads for one ESPN game (`homeId` / `awayId` are the ESPN team ids); {} when the game or its stints are not built. */
export async function retrieveGameStints(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<GameStints> {
    const out: GameStints = {};
    for (const r of await retrieveGameStintRows(league, season, espnGameId, homeId, awayId)) (out[r.espn] ??= []).push([Number(r.period), Number(r.clock_in), Number(r.clock_out)]);
    return out;
}

/** The same reads, each mapped row whole in the producer's order; [] when the game or its stints are not built. */
export async function retrieveGameStintRows(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<MappedStint[]> {
    return (await readStints(league, season, espnGameId, homeId, awayId, false)).stints;
}

/**
 * BB-G36's shift chart: the mapped stints and each mapped player's minutes (ESPN athlete id -> minutes) from the producer's
 * per-player game line, game_player_impact, by the Impact box's own query (one cache entry). The chart's MIN reads these
 * minutes; it never sums the stints (#455 Q6). Empty when the game or its stints are not built.
 */
export interface ShiftReads { stints: MappedStint[]; minutes: Record<string, number | null> }
export function retrieveShiftReads(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<ShiftReads> {
    return readStints(league, season, espnGameId, homeId, awayId, true);
}

async function readStints(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number, withMinutes: boolean): Promise<ShiftReads> {
    const s = String(season);
    const read = <T>(source: Parameters<typeof retrieveRowsFrom>[0], table: string, q: Record<string, string>) =>
        retrieveRowsFrom<T>(source, table, { season: s, ...q }, TTL, true, NBA_READ_TIMEOUT_MS);
    const pro = PRO_LEAGUES.includes(league);
    let gameId: string;
    if (pro) {
        const x = await retrieveProGame(league, season, espnGameId);
        if (!x) return { stints: [], minutes: {} };
        gameId = x.gameId;
    } else {
        // the Impact box's query string exactly (impactBox.ts), so both panels share its cache entry
        const box = await read<{ contest_id: string | null }>(leagueSource(league), 'ncaa_player_box', { espn_game_id: espnGameId, select: 'contest_id,player_id,clean_name,player', limit: '80' });
        if (!box[0]?.contest_id) return { stints: [], minutes: {} };
        gameId = String(box[0].contest_id);
    }
    // the crosswalk's producer-id column: nba_player_id / wnba_player_id, ncaa_player_id in college
    const idCol = pro ? `${league}_player_id` : 'ncaa_player_id';
    const roster = (teamId: number) => read<Record<string, string | number | null>>(BASKETBALL[league].gamesSource, pro ? 'player_crosswalk' : 'ncaa_player_crosswalk',
        { espn_team_id: String(teamId), select: `${idCol},espn_athlete_id`, limit: ROSTER_LIMIT });
    const [stints, home, away, impact] = await Promise.all([
        read<StintRow>(leagueSource(league), 'game_stints', { game_id: gameId, select: STINT_SELECT, limit: STINT_LIMIT }),
        roster(homeId),
        roster(awayId),
        withMinutes ? retrieveGamePlayerImpact(league, season, gameId) : [],
    ]);
    // ids compared as strings: the pros' are bigints, college's text
    const tag = (rows: typeof home, side: 'home' | 'away') =>
        rows.filter((r) => r[idCol] != null && r.espn_athlete_id != null).map((r) => [String(r[idCol]), { espn: String(r.espn_athlete_id), side }] as const);
    const espn = new Map([...tag(home, 'home'), ...tag(away, 'away')]);
    const minutes: ShiftReads['minutes'] = {};
    for (const r of impact) { const m = espn.get(String(r.player_id)); if (m) minutes[m.espn] = r.minutes; }
    return { stints: stints.flatMap((r) => { const m = espn.get(String(r.player_id)); return m ? [{ ...r, ...m }] : []; }), minutes };
}
