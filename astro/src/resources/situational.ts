/**
 * The Data API reads behind the team page's Situations section (BB-G25, behind 'bball-situational'): sdv-db's situational
 * splits (BB-D21, sdv-db #199) in the league's season schema (`nba_stats` / `wnba_stats`, keyed by the stats.nba.com /
 * stats.wnba.com team and player ids; `mbb` / `wbb`, keyed by the ESPN team id and the stats.ncaa.org player id). One
 * situation is one (family, split) row per team, player or five-man unit; every number is the producer's (sdv-py
 * *_situational_*). There are season rows only: no game-level situational table exists, so the game page has no control.
 * The player page reads one player's rows (every split); college first maps his ESPN athlete id to the season's
 * stats.ncaa.org id through ncaa_player_crosswalk (BB-D37).
 * Reads are strict, so an outage is never shown as a team with no possessions.
 */
import { retrieveRows } from './sdv';
import { retrieveNcaaNames, type NcaaNameRow } from './lineups';
import type { BasketballLeague } from '../utils/league';
import { isNcaaDashboards } from '../basketball/dashboards';
import { PLAYER_MIN_POSS, UNIT_MIN_POSS } from '../utils/situations';

/** The situational tables are rebuilt with the season products (once a day): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A team-season is at most 24 split rows (11 families); the caps keep a bad filter from paging silently. */
const TEAM_LIMIT = '40';
/** A team-season's players in one split: a college or NBA roster is under 30, a traded-in player included. */
const PLAYER_LIMIT = '40';
/** The five-man units listed, most possessions in the situation first. */
export const UNIT_LIMIT = 25;

export interface SituationalRow {
    family: string;
    split: string;
    games: number;
    minutes: number | null;
    poss: number;
    opp_poss: number;
    pts: number;
    opp_pts: number;
    plus_minus: number;
    off_rtg: number | null;
    def_rtg: number | null;
    net_rtg: number | null;
}
const COLS = 'family,split,games,minutes,poss,opp_poss,pts,opp_pts,plus_minus,off_rtg,def_rtg,net_rtg';

/** stats.nba.com ids (numbers) for the pros, stats.ncaa.org ids (text) for college */
export type PlayerSituationalRow = SituationalRow & { player_id: number | string };
export type UnitSituationalRow = SituationalRow & {
    lineup_id: string;
    player_1: number | string | null;
    player_2: number | string | null;
    player_3: number | string | null;
    player_4: number | string | null;
    player_5: number | string | null;
};

export interface SituationalReads {
    /** every split row of the team's (the section shows the situation's and the all row) */
    team: SituationalRow[];
    players: PlayerSituationalRow[];
    units: UnitSituationalRow[];
    /** college only: the team's ncaa_player_box rows; [] for the NBA/WNBA */
    names: NcaaNameRow[];
}

/** The team's split rows, and its players' and units' rows in one situation, most possessions first; college adds names. */
export async function retrieveSituational(league: BasketballLeague, season: number, teamId: number, family: string, split: string): Promise<SituationalReads> {
    const s = String(season);
    const t = String(teamId);
    const one = { season: s, team_id: t, family, split, order: '-poss' };
    const [team, players, units, names] = await Promise.all([
        retrieveRows<SituationalRow>(league, 'situational_team', { season: s, team_id: t, select: COLS, limit: TEAM_LIMIT }, TTL, true),
        retrieveRows<PlayerSituationalRow>(league, 'situational_player', { ...one, poss__gte: String(PLAYER_MIN_POSS), select: `player_id,${COLS}`, limit: PLAYER_LIMIT }, TTL, true),
        retrieveRows<UnitSituationalRow>(league, 'situational_lineup', { ...one, poss__gte: String(UNIT_MIN_POSS), select: `lineup_id,player_1,player_2,player_3,player_4,player_5,${COLS}`, limit: String(UNIT_LIMIT) }, TTL, true),
        retrieveNcaaNames(league, season, teamId),
    ]);
    return { team, players, units, names };
}

/**
 * One player's split rows with one team in a season (every split over the player minimum), for the player page. The pros'
 * page id is the stats id; college's is the ESPN athlete id, mapped to the season's stats.ncaa.org id first (no pair: no
 * rows). Strict.
 */
export async function retrievePlayerSituational(league: BasketballLeague, season: number, personId: number, teamId: number): Promise<PlayerSituationalRow[]> {
    const s = String(season);
    let playerId = String(personId);
    if (isNcaaDashboards(league)) {
        const pairs = await retrieveRows<{ ncaa_player_id: string }>(league, 'ncaa_player_crosswalk', { season: s, espn_athlete_id: playerId, select: 'ncaa_player_id', limit: '5' }, TTL, true);
        if (!pairs.length) return [];
        playerId = String(pairs[0].ncaa_player_id);
    }
    return retrieveRows<PlayerSituationalRow>(league, 'situational_player', { season: s, team_id: String(teamId), player_id: playerId, poss__gte: String(PLAYER_MIN_POSS), select: `player_id,${COLS}`, limit: TEAM_LIMIT }, TTL, true);
}
