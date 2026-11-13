/**
 * The Data API reads behind the game page's Impact box and Lineups used (BB-G1, behind 'bball-impact-box'): sdv-db's
 * game_player_impact and game_lineups_used (BB-D6, sdv-db #193) in the league's season schema. The pro tables are keyed
 * by stats.nba.com / stats.wnba.com ids (game, team, player), so the ESPN game is first mapped through the games
 * schema's schedule_crosswalk and the names come from the stats box; college tables are keyed by the stats.ncaa.org
 * contest and player ids with ESPN team ids, so ncaa_player_box (filtered by the ESPN game id) gives the contest id and
 * the names in one read. Player links: a pro's stats id is his player page's id; a college player's page is keyed by
 * his ESPN athlete id, so each side's ncaa_player_crosswalk pairs (BB-D37, by ESPN team and season) map the
 * stats.ncaa.org ids, and a player with no pair stays unlinked. A player page exists only for a player in the season's
 * shot_season_players (the page's own 404 check), so that list, one season-wide read cached across every game page,
 * drops the link of a player with no shots all season. Every minute, possession, point, +/- and rating is the
 * producer's (sdv-py nba_impact_rows / ncaa_impact_rows); the box reads, orders and formats. Reads are strict: an outage is never shown as
 * a game with no impact rows.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** The tables are rebuilt once a day (16:00 UTC season products): the season pages' window. */
const TTL = 6 * 60 * 60;
/** A game is at most ~40 players a side between both box reads; the cap keeps a bad filter from paging silently. */
const PLAYER_LIMIT = '80';
/** "Lineups used": each team's five most-used units, by time on court; the rest sit behind "All lineups". */
export const TOP_UNITS = 5;
/** Every unit a side used (a game's sides run ~15-25; the cap keeps a bad filter from paging silently). */
export const UNIT_LIMIT = '100';
/** The season's shooters (shot_season_players, ~5k rows in college), the read helper's cap; reaching it is a truncation. */
const PAGE_LIMIT = '50000';

/** One player's on-court totals in one game; ratings are per 100 possessions, `_n` the possessions behind them. */
export interface ImpactRow {
    team_id: number;
    player_id: number | string;
    minutes: number | null;
    poss: number | null;
    opp_poss: number | null;
    pts: number | null;
    opp_pts: number | null;
    plus_minus: number | null;
    off_rtg: number | null;
    def_rtg: number | null;
    net_rtg: number | null;
}
const IMPACT_SELECT = 'team_id,player_id,minutes,poss,opp_poss,pts,opp_pts,plus_minus,off_rtg,def_rtg,net_rtg';

/** One five-man unit's totals in one game; `player_1..5` are the impact rows' player ids. */
export interface LineupRow extends Omit<ImpactRow, 'player_id'> {
    lineup_id: string;
    player_1: number | string;
    player_2: number | string;
    player_3: number | string;
    player_4: number | string;
    player_5: number | string;
}
const LINEUP_SELECT = 'team_id,lineup_id,player_1,player_2,player_3,player_4,player_5,minutes,poss,opp_poss,pts,opp_pts,plus_minus,off_rtg,def_rtg,net_rtg';

/** A player's name, keyed by the impact tables' player id. */
export interface ImpactName { player_id: string; name: string }

export interface ImpactBoxReads {
    /** the producer's game id (stats.nba.com / stats.wnba.com game id, stats.ncaa.org contest id); null when unmapped */
    gameId: string | null;
    /** the season tables' team id of each ESPN side (stats ids for the pros, the ESPN id in college) */
    teams: { home: number; away: number } | null;
    players: ImpactRow[];
    /** each side's units, most minutes first */
    lineups: { home: LineupRow[]; away: LineupRow[] };
    names: ImpactName[];
    /** college: stats.ncaa.org player id -> ESPN athlete id (the player page's id); null for the pros, whose ids are the page's */
    pageIds: Map<string, string> | null;
    /** the player page ids the season has a page for (shot_season_players' person ids); a player outside it is unlinked */
    pages: Set<string>;
}

/** No producer rows for the game (not mapped, or not built yet). */
export const EMPTY_IMPACT: ImpactBoxReads = { gameId: null, teams: null, players: [], lineups: { home: [], away: [] }, names: [], pageIds: null, pages: new Set() };

interface ProCrosswalk { [k: string]: string | number | null }
interface ProName { person_id: number; first_name: string | null; family_name: string | null; name_i: string | null }
interface NcaaPair { ncaa_player_id: string | null; espn_athlete_id: number | string | null }
interface NcaaName { contest_id: string; player_id: string | null; clean_name: string | null; player: string | null }

/** "ANGELO.BRIZZI" (the stats.ncaa.org box's raw name) as "Angelo Brizzi", for a row with no clean name. */
const titleCase = (raw: string) => raw.replace(/[._]+/g, ' ').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()).trim();

/**
 * An ESPN NBA / WNBA game's stats.nba.com / stats.wnba.com game and team ids, from the games schema's schedule_crosswalk;
 * null when the crosswalk has no row. One capped, season-filtered read, shared (same query, same cache entry) by every
 * game page panel that reads the stats schema (the Impact box, BB-G28's Game flow).
 */
export async function retrieveProGame(league: BasketballLeague, season: number, espnGameId: string): Promise<{ gameId: string; teams: { home: number; away: number } } | null> {
    const p = league; // the crosswalk's prefix: nba_game_id / wnba_game_id
    const [x] = await retrieveRowsFrom<ProCrosswalk>(BASKETBALL[league].gamesSource, 'schedule_crosswalk',
        { season: String(season), espn_game_id: espnGameId, select: `${p}_game_id,${p}_home_team_id,${p}_away_team_id`, limit: '1' }, TTL, true, NBA_READ_TIMEOUT_MS);
    if (!x?.[`${p}_game_id`]) return null;
    return { gameId: String(x[`${p}_game_id`]), teams: { home: Number(x[`${p}_home_team_id`]), away: Number(x[`${p}_away_team_id`]) } };
}

/**
 * A pro game's player names from the stats box, keyed by the stats person id: one capped read, shared (same query, same
 * cache entry) by the Impact box and BB-G26's EPV box.
 */
export async function retrieveProNames(league: BasketballLeague, season: number, gameId: string): Promise<ImpactName[]> {
    const rows = await retrieveRowsFrom<ProName>(leagueSource(league), 'player_box',
        { season: String(season), game_id: gameId, select: 'person_id,first_name,family_name,name_i', limit: PLAYER_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
    return rows.map((r) => ({ player_id: String(r.person_id), name: [r.first_name, r.family_name].filter(Boolean).join(' ') || String(r.name_i ?? r.person_id) }));
}

/**
 * The reads for one ESPN game, two rounds, strict. `homeId` / `awayId` are the ESPN team ids. The pros: the crosswalk,
 * then the impact rows, the stats box's names, each side's units and the season's player pages; college: the stats.ncaa.org
 * box (contest id and names), then the impact rows, each side's units, each side's crosswalk pairs and the season's player
 * pages (the player links).
 */
export async function retrieveImpactBox(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<ImpactBoxReads> {
    const s = String(season);
    // the season schema (nba_stats / wnba_stats / mbb / wbb), every read season-filtered and capped, failing fast like the game's own reads
    const read = <T>(table: string, q: Record<string, string>) => retrieveRowsFrom<T>(leagueSource(league), table, { season: s, ...q }, TTL, true, NBA_READ_TIMEOUT_MS);
    let gameId: string;
    let teams: { home: number; away: number };
    let namesRead: Promise<ImpactName[]>;
    let pageIdsRead: Promise<Map<string, string> | null> = Promise.resolve(null);
    if (PRO_LEAGUES.includes(league)) {
        const x = await retrieveProGame(league, season, espnGameId);
        if (!x) return EMPTY_IMPACT;
        ({ gameId, teams } = x);
        namesRead = retrieveProNames(league, season, gameId);
    } else {
        const box = await read<NcaaName>('ncaa_player_box', { espn_game_id: espnGameId, select: 'contest_id,player_id,clean_name,player', limit: PLAYER_LIMIT });
        if (!box[0]?.contest_id) return EMPTY_IMPACT;
        gameId = String(box[0].contest_id);
        teams = { home: homeId, away: awayId };
        // a non-D1 opponent's players carry no stats.ncaa.org id (and have no impact rows)
        namesRead = Promise.resolve(box.filter((r) => r.player_id).map((r) => ({ player_id: String(r.player_id), name: r.clean_name || titleCase(String(r.player ?? r.player_id)) })));
        // each side's matched pairs (a non-D1 side has none); the bigint espn_athlete_id and text ncaa_player_id as strings
        const pairs = (teamId: number) => read<NcaaPair>('ncaa_player_crosswalk', { espn_team_id: String(teamId), select: 'ncaa_player_id,espn_athlete_id', limit: PLAYER_LIMIT });
        pageIdsRead = Promise.all([pairs(homeId), pairs(awayId)]).then((sides) =>
            new Map(sides.flat().filter((r) => r.ncaa_player_id && r.espn_athlete_id != null).map((r) => [String(r.ncaa_player_id), String(r.espn_athlete_id)])));
    }
    const units = (teamId: number) => read<LineupRow>('game_lineups_used', { game_id: gameId, team_id: String(teamId), select: LINEUP_SELECT, order: '-seconds', limit: UNIT_LIMIT });
    const pagesRead = read<{ person_id: number | string }>('shot_season_players', { select: 'person_id', limit: PAGE_LIMIT }).then((rows) => {
        if (rows.length >= Number(PAGE_LIMIT)) throw new Error(`shot_season_players reached the ${PAGE_LIMIT}-row cap: the read is truncated`);
        return new Set(rows.map((r) => String(r.person_id)));
    });
    const [players, home, away, nameRows, pageIds, pages] = await Promise.all([
        read<ImpactRow>('game_player_impact', { game_id: gameId, select: IMPACT_SELECT, limit: PLAYER_LIMIT }),
        units(teams.home),
        units(teams.away),
        namesRead,
        pageIdsRead,
        pagesRead,
    ]);
    return { gameId, teams, players, lineups: { home, away }, names: nameRows, pageIds, pages };
}
