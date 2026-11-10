/**
 * The reads behind BB-G42's Game info (behind 'bball-game-info'). The crew: an ingested final's `{lg}.officials` rows (the
 * page never touches ESPN for one), else ESPN's summary. Profiles: the game season's official_seasons (BB-D34, sdv-db #214)
 * in the league's season schema, all of it (the league average needs every official). The pros' injury report: ESPN's
 * summary before and during the game; for a final the last `{nba,wnba}.espn_injuries` snapshot filed by the game day (within
 * SNAPSHOT_DAYS), since a final's summary carries today's report, not the game day's. Snapshots skip days. College has no injury source. Strict: a failed read is never an empty crew.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { retrieveGameSummary, type ESPNGameSummary } from './espn';
import type { NbaGame } from './nbaGame';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';
import { easternDate, injuriesFromSnapshot, latestSnapshot, shiftDate, injuriesFromSummary, officialsFromSummary, officialsFromTable, type GameInfoReads, type OfficialSeason } from '../utils/gameInfo';

/** The season products' window (official_seasons is rebuilt with them). */
const TTL = 6 * 60 * 60;
const YEAR = 60 * 60 * 24 * 365;
/** A final's crew and its day's snapshot never change once written; until they are, re-read on the season window. */
const settled = (content: any) => (Array.isArray(content?.data) && content.data.length > 0 ? YEAR : TTL);
/** An MBB season is about a thousand officials; the cap keeps a bad filter from paging silently. */
const PROFILE_LIMIT = '5000';
/** A league-wide day's report is about a hundred players; the window holds up to four of them. */
const INJURY_LIMIT = '1000';
/** How far before the game day a snapshot still counts as the game's report. */
const SNAPSHOT_DAYS = 3;
const PROFILE_SELECT = 'season,official_id,official_name,games,fouls_per_game,fouls_per_game_n,fta_per_game,fta_per_game_n,pace,pace_n,home_win_pct,home_win_pct_n,home_minus_away_fouls,home_minus_away_fouls_n';
const INJURY_SELECT = 'as_of_date,team_id,athlete_id,athlete_display_name,status,detail_type,detail_side,detail_detail,detail_return_date';
/** A slow ESPN costs the panel, never the page (as the pregame's summary). */
const SUMMARY_TIMEOUT_MS = 3000;

const latestRows = (rows: Record<string, any>[]) => { const d = latestSnapshot(rows); return rows.filter((r) => r.as_of_date === d); };

async function capped<T>(rows: Promise<T[]>, limit: string, what: string): Promise<T[]> {
    const r = await rows;
    if (r.length >= Number(limit)) throw new Error(`${what}: ${r.length} rows, at the ${limit} cap`);
    return r;
}

/** The season's official profiles; empty when the season has no officials release. */
export const retrieveOfficialSeasons = (league: BasketballLeague, season: number): Promise<OfficialSeason[]> =>
    capped(retrieveRowsFrom<OfficialSeason>(leagueSource(league), 'official_seasons', { season: String(season), select: PROFILE_SELECT, limit: PROFILE_LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS), PROFILE_LIMIT, 'official_seasons');

/** The pregame page's: the summary it already holds, and the profiles. */
export async function pregameInfo(league: BasketballLeague, season: number | null, summary: ESPNGameSummary | null): Promise<GameInfoReads> {
    if (!summary) throw new Error('ESPN summary: no answer');
    const profiles = season != null ? await retrieveOfficialSeasons(league, season) : [];
    return { officials: officialsFromSummary(summary), profiles, ...(PRO_LEAGUES.includes(league) ? { injuries: { snapshot: false, asOf: null, rows: injuriesFromSummary(summary) } } : {}) };
}

/** A live or final game's. */
export async function retrieveGameInfo(league: BasketballLeague, game: NbaGame): Promise<GameInfoReads> {
    const pro = PRO_LEAGUES.includes(league);
    const ingested = game.source === 'data_api';
    // a final's report is the snapshot (a final's summary has today's); every read carries the season, so none without one
    const final = pro && game.status.completed;
    const asOf = final && game.season != null ? easternDate(game.date) : null;
    const games = BASKETBALL[league].gamesSource;
    const seasonQ: Record<string, string> = game.season != null ? { season: String(game.season) } : {};
    const [summary, crewRows, snapshot, profiles] = await Promise.all([
        !ingested || (pro && !final) ? retrieveGameSummary(game.id, league, AbortSignal.timeout(SUMMARY_TIMEOUT_MS)).then((s) => { if (!s) throw new Error('ESPN summary: no answer'); return s; }) : null,
        ingested && game.season != null ? retrieveRowsFrom<Record<string, any>>(games, 'officials', { ...seasonQ, game_id: game.id, limit: '20' }, settled, true, NBA_READ_TIMEOUT_MS) : null,
        asOf ? capped(retrieveRowsFrom<Record<string, any>>(games, 'espn_injuries', { ...seasonQ, as_of_date__gte: shiftDate(asOf, -SNAPSHOT_DAYS), as_of_date__lte: asOf, order: '-as_of_date', select: INJURY_SELECT, limit: INJURY_LIMIT },
            // held once the game day's own snapshot is in (the newest row first); until then a later filing may still land
            (c: any) => (c?.data?.[0]?.as_of_date === asOf ? YEAR : TTL), true, NBA_READ_TIMEOUT_MS), INJURY_LIMIT, 'espn_injuries') : null,
        game.season != null ? retrieveOfficialSeasons(league, game.season) : [],
    ]);
    const teams = [Number(game.home.team.id), Number(game.away.team.id)];
    return {
        officials: ingested ? officialsFromTable(crewRows ?? []) : officialsFromSummary(summary),
        profiles,
        ...(pro ? { injuries: final ? { snapshot: true, asOf: latestSnapshot(snapshot ?? []), rows: injuriesFromSnapshot(latestRows(snapshot ?? []), teams) } : { snapshot: false, asOf: null, rows: injuriesFromSummary(summary).filter((r) => teams.includes(r.teamId)) } } : {}),
    };
}
