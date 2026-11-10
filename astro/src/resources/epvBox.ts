/**
 * The Data API reads behind BB-G26's EPV box (behind 'bball-epv'): sdv-db's nba_stats.epv_player_games and
 * epv_team_games (BB-D24, sdv-db #201, from sdv-py nba_epv_player_games / _team_games, sportsdataverse-py #1113). EPV is
 * the offense's expected points to the end of the possession; EPV added (points + EPV after - EPV before) is
 * basketball's EPA. All four leagues from 2021-22 (the WNBA from 2022; BB-G46 for the WNBA and college): the boosters'
 * first training season, sdv-py refuses earlier ones. As the Impact box (resources/impactBox.ts), the pro tables are keyed
 * by stats.nba.com / stats.wnba.com ids, so the ESPN game is mapped through schedule_crosswalk; the NBA's names come from
 * the stats box (the same reads, the same cache entries), the WNBA's from the season's player crosswalk (its stats box
 * starts in 2026). College tables are keyed by the stats.ncaa.org contest and player ids with ESPN team ids, so the
 * stats.ncaa.org box, filtered by the ESPN game id, gives the contest id and the names in one read (the Impact box's).
 * Every number is the producer's; the box reads, orders and formats. Reads are strict: an outage is never shown as a
 * game with no rows.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { retrieveProGame, retrieveProNames, titleCase, type ImpactName } from './impactBox';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** The tables are rebuilt once a day (the 16:00 UTC season products): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A game is at most ~40 players between both sides; the cap keeps a bad filter from paging silently. */
const PLAYER_LIMIT = '80';
/** A WNBA season's players in the crosswalk: ~270 rows (a traded player once per team); the cap is well above. */
const WNBA_NAME_LIMIT = '600';
/** The EPV boosters' first training season (sdv-py nba_epv / wnba_epv / mbb_epv refuse earlier ones): 2021-22, the WNBA's 2022. */
export const EPV_FIRST_SEASON = 2022;

/** Whether the league and season have EPV tables at all: every league from 2021-22. Earlier spends no read and shows no panel. */
export const hasEpv = (_league: BasketballLeague, season: number) => season >= EPV_FIRST_SEASON;

/** One player's EPV in one game: added on their own events, and the on-court EPV +/- (off - def). */
export interface EpvPlayerRow {
    team_id: number;
    player_id: number | string;
    epv_own: number | null;
    own_actions: number | null;
    off_epv_on: number | null;
    def_epv_on: number | null;
    epv_on: number | null;
}
const PLAYER_SELECT = 'team_id,player_id,epv_own,own_actions,off_epv_on,def_epv_on,epv_on';

/** One team's EPV in one game: added with the ball (off), by the opponent (def), and per possession. */
export interface EpvTeamRow {
    team_id: number;
    off_epv: number | null;
    def_epv: number | null;
    net_epv: number | null;
    poss: number | null;
    opp_poss: number | null;
    off_epv_per_poss: number | null;
    def_epv_per_poss: number | null;
}
const TEAM_SELECT = 'team_id,off_epv,def_epv,net_epv,poss,opp_poss,off_epv_per_poss,def_epv_per_poss';

export interface EpvBoxReads {
    /** the producer's game id (stats.nba.com / stats.wnba.com game id, stats.ncaa.org contest id); null when unmapped */
    gameId: string | null;
    /** the tables' team id of each ESPN side (stats ids for the pros, the ESPN id in college) */
    teams: { home: number; away: number } | null;
    players: EpvPlayerRow[];
    team: EpvTeamRow[];
    names: ImpactName[];
}
/** No producer rows for the game (not mapped, or not built yet). */
export const EMPTY_EPV: EpvBoxReads = { gameId: null, teams: null, players: [], team: [], names: [] };

interface NcaaName { contest_id: string; player_id: string | null; clean_name: string | null; player: string | null }
interface WnbaName { wnba_player_id: number | null; wnba_player_name: string | null }

/** A WNBA season's names by stats.wnba.com person id: one season-filtered, capped read, shared by every WNBA game that season. */
async function retrieveWnbaNames(season: number): Promise<ImpactName[]> {
    const rows = await retrieveRowsFrom<WnbaName>(BASKETBALL.wnba.gamesSource, 'player_crosswalk',
        { season: String(season), select: 'wnba_player_id,wnba_player_name', limit: WNBA_NAME_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
    return rows.filter((r) => r.wnba_player_id != null && r.wnba_player_name).map((r) => ({ player_id: String(r.wnba_player_id), name: String(r.wnba_player_name) }));
}

/**
 * One ESPN game's reads, strict, two rounds. The pros: the crosswalk, then the players, the two team rows and the names;
 * college: the stats.ncaa.org box (the contest id and the names; `homeId` / `awayId`, the ESPN team ids, are the tables'
 * own), then the players and the two team rows. Call only when hasEpv.
 */
export async function retrieveEpvBox(league: BasketballLeague, season: number, espnGameId: string, homeId?: number, awayId?: number): Promise<EpvBoxReads> {
    const s = String(season);
    let gameId: string;
    let teams: { home: number; away: number };
    let namesRead: Promise<ImpactName[]>;
    if (PRO_LEAGUES.includes(league)) {
        const x = await retrieveProGame(league, season, espnGameId);
        if (!x) return EMPTY_EPV;
        ({ gameId, teams } = x);
        namesRead = league === 'nba' ? retrieveProNames(league, season, gameId) : retrieveWnbaNames(season);
    } else {
        // the Impact box's query, key for key: one cache entry for both panels
        const box = await retrieveRowsFrom<NcaaName>(leagueSource(league), 'ncaa_player_box',
            { season: s, espn_game_id: espnGameId, select: 'contest_id,player_id,clean_name,player', limit: PLAYER_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
        if (!box[0]?.contest_id || homeId == null || awayId == null) return EMPTY_EPV;
        gameId = String(box[0].contest_id);
        teams = { home: homeId, away: awayId };
        // a non-D1 opponent's players carry no stats.ncaa.org id (and have no EPV rows)
        namesRead = Promise.resolve(box.filter((r) => r.player_id).map((r) => ({ player_id: String(r.player_id), name: r.clean_name || titleCase(String(r.player ?? r.player_id)) })));
    }
    const read = <T>(table: string, select: string, limit: string) =>
        retrieveRowsFrom<T>(leagueSource(league), table, { season: s, game_id: gameId, select, limit }, TTL, true, NBA_READ_TIMEOUT_MS);
    const [players, team, names] = await Promise.all([
        read<EpvPlayerRow>('epv_player_games', PLAYER_SELECT, PLAYER_LIMIT),
        read<EpvTeamRow>('epv_team_games', TEAM_SELECT, '2'),
        namesRead,
    ]);
    return { gameId, teams, players, team, names };
}

export interface EpvSide {
    team: EpvTeamRow | null;
    /** most EPV added on their own events first */
    players: (EpvPlayerRow & { name: string })[];
}

/** One ESPN side's rows. A player the box does not name keeps their id (never dropped: the on-court sums would stop adding up). */
export function epvSide(reads: EpvBoxReads, side: 'home' | 'away'): EpvSide {
    const teamId = reads.teams?.[side];
    const nameOf = new Map(reads.names.map((n) => [n.player_id, n.name]));
    const players = reads.players.filter((p) => Number(p.team_id) === teamId)
        .sort((a, b) => (b.epv_own ?? 0) - (a.epv_own ?? 0) || String(a.player_id).localeCompare(String(b.player_id)))
        .map((p) => ({ ...p, name: nameOf.get(String(p.player_id)) ?? `#${p.player_id}` }));
    return { team: reads.team.find((t) => Number(t.team_id) === teamId) ?? null, players };
}
