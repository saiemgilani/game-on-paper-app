/**
 * The Data API reads behind BB-G26's EPV box (behind 'bball-epv'): sdv-db's nba_stats.epv_player_games and
 * epv_team_games (BB-D24, sdv-db #201, from sdv-py nba_epv_player_games / _team_games, sportsdataverse-py #1113). EPV is
 * the offense's expected points to the end of the possession; EPV added (points + EPV after - EPV before) is
 * basketball's EPA. NBA only, 2021-22 on: the WNBA booster is not shipped and sdv-py refuses earlier seasons. As the
 * Impact box (resources/impactBox.ts), the tables are keyed by stats.nba.com ids, so the ESPN game is mapped through
 * schedule_crosswalk and the names come from the stats box (the same reads, the same cache entries). Every number is the
 * producer's; the box reads, orders and formats. Reads are strict: an outage is never shown as a game with no rows.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { retrieveProGame, retrieveProNames, type ImpactName } from './impactBox';
import { leagueSource, type BasketballLeague } from '../utils/league';

/** The tables are rebuilt once a day (the 16:00 UTC season products): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A game is at most ~40 players between both sides; the cap keeps a bad filter from paging silently. */
const PLAYER_LIMIT = '80';
/** The EPV booster's first training season (sdv-py nba_epv refuses earlier ones): 2021-22. */
export const EPV_FIRST_SEASON = 2022;

/** Whether the league and season have EPV tables at all: the NBA from 2021-22. Anything else spends no read and shows no panel. */
export const hasEpv = (league: BasketballLeague, season: number) => league === 'nba' && season >= EPV_FIRST_SEASON;

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

/** One scored play (sdv-db epv_plays, GOP Q35): the producer's EPV before and after it, and the EPV it added. */
export interface EpvPlayRow {
    /** 1-4, and 5 for any overtime (the booster's state: 2OT reads as OT) */
    period: number;
    /** seconds left in the period */
    seconds_remaining: number | null;
    /** the event's team (stats id) */
    team_id: number | null;
    /** null on a team event */
    player_id: number | string | null;
    description: string | null;
    points: number | null;
    epv_before: number | null;
    epv_after: number | null;
    epv_added: number | null;
}
const PLAY_SELECT = 'period,seconds_remaining,team_id,player_id,description,points,epv_before,epv_after,epv_added';
/** The biggest plays list's length. */
export const PLAY_LIMIT = '10';

export interface EpvBoxReads {
    /** the stats.nba.com game id; null when the crosswalk does not map the game */
    gameId: string | null;
    /** the stats team id of each ESPN side */
    teams: { home: number; away: number } | null;
    players: EpvPlayerRow[];
    team: EpvTeamRow[];
    names: ImpactName[];
    /** the game's plays by EPV added, most first (the producer's order) */
    plays: EpvPlayRow[];
}
/** No producer rows for the game (not mapped, or not built yet). */
export const EMPTY_EPV: EpvBoxReads = { gameId: null, teams: null, players: [], team: [], names: [], plays: [] };

/** One ESPN game's reads, strict: the crosswalk, then the players, the two team rows, the names and the biggest plays. Call only when hasEpv. */
export async function retrieveEpvBox(league: BasketballLeague, season: number, espnGameId: string): Promise<EpvBoxReads> {
    const x = await retrieveProGame(league, season, espnGameId);
    if (!x) return EMPTY_EPV;
    const { gameId, teams } = x;
    const read = <T>(table: string, select: string, limit: string, extra: Record<string, string> = {}) =>
        retrieveRowsFrom<T>(leagueSource(league), table, { season: String(season), game_id: gameId, select, ...extra, limit }, TTL, true, NBA_READ_TIMEOUT_MS);
    const [players, team, names, plays] = await Promise.all([
        read<EpvPlayerRow>('epv_player_games', PLAYER_SELECT, PLAYER_LIMIT),
        read<EpvTeamRow>('epv_team_games', TEAM_SELECT, '2'),
        retrieveProNames(league, season, gameId),
        read<EpvPlayRow>('epv_plays', PLAY_SELECT, PLAY_LIMIT, { order: '-epv_added' }),
    ]);
    return { gameId, teams, players, team, names, plays };
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

/** A play's moment: the quarter (OT for any overtime: the table has one OT state) and the period clock, m:ss. */
export function playClock(p: Pick<EpvPlayRow, 'period' | 'seconds_remaining'>): string {
    const q = Number(p.period) >= 5 ? 'OT' : `Q${p.period}`;
    if (p.seconds_remaining == null) return q;
    const s = Math.max(0, Math.floor(Number(p.seconds_remaining)));
    return `${q} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
