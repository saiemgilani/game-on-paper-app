/**
 * The Data API read behind BB-G32's season context (behind 'bball-team-grid'): sdv-db's season team rates (BB-D3,
 * `team_season_rates`, split `all`) in the league's season schema (`nba_stats` / `wnba_stats`, keyed by the stats.nba.com /
 * stats.wnba.com team id; `mbb` / `wbb`, keyed by the ESPN id). One read of the whole league's season gives both sides'
 * season rates and the league average the four-factor accounting is priced against. Every rate is the producer's,
 * counted from possessions; the league average is their possession-weighted mean. Strict: an outage is never a team
 * with no season.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { retrieveProGame } from './impactBox';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day (16:00 UTC): the season pages' window. */
const TTL = 6 * 60 * 60;
/** One row a team: 30 NBA, 13-15 WNBA, ~365 D-I teams in college. A read at the cap is truncated, so it fails loud. */
const LIMIT = '1000';
const SELECT = 'team_id,games,poss,pts,efg_pct,tov_pct,orb_pct,ft_rate,off_rtg,def_rtg,pace';

/** A team's (or the league's) season rates, as fractions; ratings per 100 counted possessions. */
export interface SeasonRates {
    efg_pct: number | null; tov_pct: number | null; orb_pct: number | null; ft_rate: number | null
    off_rtg: number | null; def_rtg: number | null; pace: number | null
}

export interface TeamGridSeason {
    /** null: the producer has no row for the side (not built yet, or an unmapped franchise) */
    home: SeasonRates | null
    away: SeasonRates | null
    /** the possession-weighted league average; null with no rows. `ppp` is points per counted possession. */
    league: (SeasonRates & { ppp: number }) | null
    /** a final only (retrieveTeamGridFinal): the game's counted rows; absent for a live game */
    game?: TeamGridGame
}

/** One situational_team_games row (sdv-db BB-D21, per team-game): possessions, points and ratings per 100 counted possessions. */
export interface GameSituationalRow {
    family: string; split: string; poss: number | null; opp_poss: number | null; pts: number | null; opp_pts: number | null
    off_rtg: number | null; def_rtg: number | null; net_rtg: number | null
}

/**
 * A final's counted rows, the definition the season rows share: each side's possessions (team_game_possessions, split all)
 * and every situational_team_games row (family all carries the game's ratings). Empty when the game is not mapped.
 */
export interface TeamGridGame {
    poss: { home: number | null; away: number | null }
    home: GameSituationalRow[]
    away: GameSituationalRow[]
}

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const RATE_KEYS = ['efg_pct', 'tov_pct', 'orb_pct', 'ft_rate', 'off_rtg', 'def_rtg', 'pace'] as const;
const rates = (r: Row): SeasonRates => Object.fromEntries(RATE_KEYS.map((k) => [k, num(r[k])])) as unknown as SeasonRates;

/** Both sides' rows (by the season tables' team id) and the league's possession-weighted mean of every rate. */
export function teamGridSeason(rows: readonly Row[], homeId: number | null, awayId: number | null): TeamGridSeason {
    const side = (id: number | null) => { const r = id == null ? undefined : rows.find((x) => num(x.team_id) === id); return r ? rates(r) : null; };
    const played = rows.filter((r) => (num(r.poss) ?? 0) > 0);
    const poss = played.reduce((s, r) => s + num(r.poss)!, 0);
    const mean = (k: (typeof RATE_KEYS)[number]) => {
        const w = played.filter((r) => num(r[k]) != null);
        const n = w.reduce((s, r) => s + num(r.poss)!, 0);
        return n > 0 ? w.reduce((s, r) => s + num(r[k])! * num(r.poss)!, 0) / n : null;
    };
    const league = poss > 0 ? { ...(Object.fromEntries(RATE_KEYS.map((k) => [k, mean(k)])) as unknown as SeasonRates), ppp: played.reduce((s, r) => s + (num(r.pts) ?? 0), 0) / poss } : null;
    return { home: side(homeId), away: side(awayId), league };
}

/** The season tables' team id of an ESPN team: the stats id for the pros (the league's team list), the ESPN id in college. */
export function seasonTeamId(league: BasketballLeague, espnId: number): number | null {
    return PRO_LEAGUES.includes(league) ? (BASKETBALL[league].teams.byEspnId(espnId)?.team_id ?? null) : espnId;
}

/** Every family's rows of a team-game: ~20 splits a side, more with overtimes. The cap keeps a bad filter from paging silently. */
const SITUATIONAL_LIMIT = '60';
const SITUATIONAL_SELECT = 'team_id,family,split,games,minutes,poss,opp_poss,pts,opp_pts,plus_minus,off_rtg,def_rtg,net_rtg';

/**
 * A final's counted rows. Both tables are keyed like the season tables: the pros by the stats game and team ids (the ESPN
 * game through the games schema's schedule_crosswalk, the read the Impact box shares), college by the stats.ncaa.org
 * contest id (the ESPN game through ncaa_team_box) and the ESPN team ids. Not mapped: no rows. Strict.
 */
export async function retrieveTeamGridGame(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<TeamGridGame> {
    const read = <T>(table: string, q: Record<string, string>) => retrieveRowsFrom<T>(leagueSource(league), table, { season: String(season), ...q }, TTL, true, NBA_READ_TIMEOUT_MS);
    let gameId: string | null = null;
    let teams = { home: homeId, away: awayId };
    if (PRO_LEAGUES.includes(league)) {
        const x = await retrieveProGame(league, season, espnGameId);
        if (x) ({ gameId, teams } = x);
    } else {
        const box = await read<{ contest_id: string | number | null }>('ncaa_team_box', { espn_game_id: espnGameId, select: 'contest_id', limit: '4' });
        gameId = box.find((r) => r.contest_id != null)?.contest_id?.toString() ?? null;
    }
    if (!gameId) return { poss: { home: null, away: null }, home: [], away: [] };
    const [poss, sit] = await Promise.all([
        read<Row>('team_game_possessions', { game_id: gameId, split: 'all', select: 'team_id,poss', limit: '4' }),
        read<Row>('situational_team_games', { game_id: gameId, select: SITUATIONAL_SELECT, limit: SITUATIONAL_LIMIT }),
    ]);
    if (sit.length >= Number(SITUATIONAL_LIMIT)) throw new Error(`situational_team_games: ${sit.length} rows for ${league} game ${gameId}, at the ${SITUATIONAL_LIMIT} cap`);
    const of = (id: number) => (rows: Row[]) => rows.filter((r) => num(r.team_id) === id);
    const sitRow = (r: Row): GameSituationalRow => ({ family: String(r.family), split: String(r.split), poss: num(r.poss), opp_poss: num(r.opp_poss), pts: num(r.pts), opp_pts: num(r.opp_pts), off_rtg: num(r.off_rtg), def_rtg: num(r.def_rtg), net_rtg: num(r.net_rtg) });
    return {
        poss: { home: num(of(teams.home)(poss)[0]?.poss), away: num(of(teams.away)(poss)[0]?.poss) },
        home: of(teams.home)(sit).map(sitRow), away: of(teams.away)(sit).map(sitRow),
    };
}

/** A final's grid reads: the season context and the game's counted rows, in parallel (the readPanel signature). */
export async function retrieveTeamGridFinal(league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number): Promise<TeamGridSeason> {
    const [s, game] = await Promise.all([retrieveTeamGridSeason(league, season, espnGameId, homeId, awayId), retrieveTeamGridGame(league, season, espnGameId, homeId, awayId)]);
    return { ...s, game };
}

/** The readPanel signature: league, season, ESPN game id, home and away ESPN ids. */
export async function retrieveTeamGridSeason(league: BasketballLeague, season: number, _espnGameId: string, homeId: number, awayId: number): Promise<TeamGridSeason> {
    const rows = await retrieveRowsFrom<Row>(leagueSource(league), 'team_season_rates', { season: String(season), split: 'all', select: SELECT, limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
    if (rows.length >= Number(LIMIT)) throw new Error(`team_season_rates: ${rows.length} rows for ${league} ${season}, at the ${LIMIT} cap`);
    return teamGridSeason(rows, seasonTeamId(league, homeId), seasonTeamId(league, awayId));
}
