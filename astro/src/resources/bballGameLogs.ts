/**
 * The Data API reads behind the advanced game logs (BB-G50, behind 'bball-game-logs'). Every number is the producer's;
 * the logs read, join and format.
 *
 * Player (the page's per-game shot rows are the log's games): the box, game_player_rates (TS%, usage),
 * shot_quality_game (points over expected), game_player_impact (on-court possessions, +/-, ratings) and
 * epv_player_games (EPV added on his own events). The pro season tables are keyed by stats.nba.com / stats.wnba.com
 * ids; game_player_rates by ESPN's, so the pros map through player_crosswalk and schedule_crosswalk. College tables are
 * ESPN-keyed except the impact and EPV tables (stats.ncaa.org contest and player ids): his season's stats.ncaa.org id
 * comes from ncaa_player_crosswalk (BB-D37; stats.ncaa.org issues a new id every season, so the read is season-filtered)
 * and each contest's ESPN game from his own ncaa_player_box rows. With no matched pair those columns stay blank.
 *
 * Team: game_flow (lead share, lead changes, largest lead, best run) on top of the season block's game_team_rates.
 */
import { retrieveRowsFrom } from './sdv';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day: the season pages' window. */
const TTL = 6 * 60 * 60;
/** A season is at most ~110 games for one player or team (pro regular season plus playoffs); the cap keeps a bad filter from paging silently. */
const GAME_LIMIT = '200';
/** One pro season's games (NBA ~1,320 with the playoffs). */
const SEASON_GAMES_LIMIT = '2500';

export interface BoxRow { game_id: string; min: number | null; pts: number | null; reb: number | null; ast: number | null; stl: number | null; blk: number | null; tov: number | null; fgm: number | null; fga: number | null; fg3m: number | null; fg3a: number | null; ftm: number | null; fta: number | null }
export interface RatesRow { ts_pct: number | null; usg_pct: number | null }
export interface ImpactRow { poss: number | null; plus_minus: number | null; off_rtg: number | null; def_rtg: number | null }
export interface PlayerLogReads {
    /** every map is keyed by the page's game id (shot_player_games': the stats id for the pros, ESPN's for college) */
    box: Map<string, BoxRow>;
    rates: Map<string, RatesRow>;
    impact: Map<string, ImpactRow>;
    poe: Map<string, number | null>;
    epv: Map<string, number | null>;
    /** the page's game id -> the ESPN game id (the game page link); identity for college */
    espnGame: Map<string, string>;
    /** an optional read failed: its columns are blank, and the page is not cached */
    degraded: boolean;
}

export interface FlowRow { lead_pct: number | null; lead_changes: number | null; largest_lead: number | null; max_run: number | null }

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** "34:12" (stats box) or 34.2 (ESPN box) -> minutes */
const minutes = (v: unknown): number | null => {
    if (typeof v === 'string' && v.includes(':')) { const [m, s] = v.split(':').map(Number); return Number.isFinite(m) && Number.isFinite(s) ? m + s / 60 : null; }
    return num(v);
};
const by = <R extends Record<string, unknown>, V>(rows: R[], key: string, pick: (r: R) => V) => new Map(rows.map((r) => [String(r[key]), pick(r)]));
const settled = <T>(r: PromiseSettledResult<T>, empty: T): T => (r.status === 'fulfilled' ? r.value : empty);

/** One pro season's ESPN game id per stats game id (schedule_crosswalk): one cached read shared by every page of the season. */
async function proGames(league: BasketballLeague, season: number): Promise<Map<string, string>> {
    const rows = await retrieveRowsFrom<Record<string, unknown>>(BASKETBALL[league].gamesSource, 'schedule_crosswalk',
        { season: String(season), select: `espn_game_id,${league}_game_id`, limit: SEASON_GAMES_LIMIT }, TTL, true);
    return new Map(rows.filter((r) => r[`${league}_game_id`] && r.espn_game_id).map((r) => [String(r[`${league}_game_id`]), String(r.espn_game_id)]));
}

/** The player log's reads. Throws when the box read fails (no log without it); any other failed read leaves its columns blank. */
export async function retrievePlayerGameLog(league: BasketballLeague, season: number, personId: number): Promise<PlayerLogReads> {
    const s = String(season), p = String(personId);
    const stats = leagueSource(league), games = BASKETBALL[league].gamesSource;
    const pro = PRO_LEAGUES.includes(league);
    const read = (src: typeof stats, table: string, q: Record<string, string>) => retrieveRowsFrom<Record<string, unknown>>(src, table, { season: s, ...q, limit: GAME_LIMIT }, TTL, true);

    const boxR = pro
        ? read(stats, 'player_box', { person_id: p, select: 'game_id,minutes,points,rebounds_total,assists,steals,blocks,turnovers,field_goals_made,field_goals_attempted,three_pointers_made,three_pointers_attempted,free_throws_made,free_throws_attempted' })
        : read(games, 'player_box', { athlete_id: p, select: 'game_id,minutes,points,rebounds,assists,steals,blocks,turnovers,field_goals_made,field_goals_attempted,three_point_field_goals_made,three_point_field_goals_attempted,free_throws_made,free_throws_attempted' });
    // the pros' rates are ESPN-keyed: his ESPN athlete id first, then his rows, then the season's game crosswalk
    const espnGameR = pro ? proGames(league, season) : Promise.resolve(null);
    const ratesR = (async () => {
        let athlete = p;
        if (pro) {
            const [x] = await read(games, 'player_crosswalk', { [`${league}_player_id`]: p, select: 'espn_athlete_id' });
            if (!x?.espn_athlete_id) return [];
            athlete = String(x.espn_athlete_id);
        }
        return read(games, 'game_player_rates', { athlete_id: athlete, select: 'game_id,ts_pct,usg_pct' });
    })();
    const poeR = read(stats, 'shot_quality_game', { person_id: p, level: 'player', select: 'game_id,poe' });
    // college: his season's stats.ncaa.org id first (null: no matched pair, so no impact or EPV read), then his contests'
    // ESPN games. The crosswalk's espn_athlete_id is a bigint and ncaa_player_id text: both are compared as strings.
    const ncaaR: Promise<string | null> = pro ? Promise.resolve(p) : read(stats, 'ncaa_player_crosswalk', { espn_athlete_id: p, select: 'ncaa_player_id' })
        .then(([x]) => (x?.ncaa_player_id ? String(x.ncaa_player_id) : null));
    const contestsR = pro ? Promise.resolve(null) : ncaaR.then((id) => (id ? read(stats, 'ncaa_player_box', { player_id: id, select: 'contest_id,espn_game_id' }) : []));
    const byPlayer = (table: string, select: string) => ncaaR.then((id) => (id ? read(stats, table, { player_id: id, select }) : []));
    const impactR = byPlayer('game_player_impact', 'game_id,poss,plus_minus,off_rtg,def_rtg');
    const epvR = byPlayer('epv_player_games', 'game_id,epv_own');

    const [box, espnGame, rates, poe, impact, epv, contests] = await Promise.allSettled([boxR, espnGameR, ratesR, poeR, impactR, epvR, contestsR]);
    if (box.status === 'rejected') throw box.reason;
    const optional = [espnGame, rates, poe, impact, epv, contests];
    const degraded = optional.some((r) => r.status === 'rejected');
    for (const r of optional) if (r.status === 'rejected') console.error(`player ${personId} game log: a read failed: ${r.reason}`);
    // the impact and EPV rows' game id -> the page's: the stats id itself for the pros, the contest's ESPN game in college
    const contestRows = settled(contests, []);
    const toPage = pro ? null : new Map(contestRows.filter((r) => r.contest_id && r.espn_game_id).map((r) => [String(r.contest_id), String(r.espn_game_id)]));
    const rekey = <V>(rows: Record<string, unknown>[], pick: (r: Record<string, unknown>) => V) => new Map(rows.flatMap((r) => {
        const id = toPage ? toPage.get(String(r.game_id)) : String(r.game_id);
        return id ? [[id, pick(r)] as const] : [];
    }));

    const toStats = settled(espnGame, null);
    // ESPN game id -> the page's id, for the ESPN-keyed rates
    const fromEspn = toStats ? new Map([...toStats].map(([k, v]) => [v, k])) : null;
    const ratesRows = settled(rates, []);
    return {
        box: by(box.value, 'game_id', (r) => ({
            game_id: String(r.game_id), min: minutes(r.minutes), pts: num(r.points), reb: num(r.rebounds_total ?? r.rebounds), ast: num(r.assists),
            stl: num(r.steals), blk: num(r.blocks), tov: num(r.turnovers), fgm: num(r.field_goals_made), fga: num(r.field_goals_attempted),
            fg3m: num(r.three_pointers_made ?? r.three_point_field_goals_made), fg3a: num(r.three_pointers_attempted ?? r.three_point_field_goals_attempted),
            ftm: num(r.free_throws_made), fta: num(r.free_throws_attempted),
        })),
        rates: new Map(ratesRows.flatMap((r) => {
            const id = fromEspn ? fromEspn.get(String(r.game_id)) : String(r.game_id);
            return id ? [[id, { ts_pct: num(r.ts_pct), usg_pct: num(r.usg_pct) }] as const] : [];
        })),
        impact: rekey(settled(impact, []), (r) => ({ poss: num(r.poss), plus_minus: num(r.plus_minus), off_rtg: num(r.off_rtg), def_rtg: num(r.def_rtg) })),
        poe: by(settled(poe, []), 'game_id', (r) => num(r.poe)),
        epv: rekey(settled(epv, []), (r) => num(r.epv_own)),
        espnGame: toStats ?? new Map(),
        degraded,
    };
}

/** One game_flow row as read, with the keys the team log joins on. */
interface FlowRead extends FlowRow { game_id: string; opp_team_id: number | null; pts: number | null; opp_pts: number | null }

/**
 * The team's game_flow rows keyed by ESPN game id. Pros: the stats game id through schedule_crosswalk. College: the
 * rows carry the stats.ncaa.org contest id, so each is matched to its ESPN game by opponent and final score (`games`:
 * the block's schedule); a game two rows would match is left out.
 */
export async function retrieveTeamGameFlow(league: BasketballLeague, season: number, teamId: number, espnId: number,
    games: { gameId: string; oppId: number; teamScore: number | null; oppScore: number | null }[]): Promise<Map<string, FlowRow>> {
    const pro = PRO_LEAGUES.includes(league);
    const [rows, toEspn] = await Promise.all([
        retrieveRowsFrom<Record<string, unknown>>(leagueSource(league), 'game_flow', { season: String(season), team_id: String(pro ? teamId : espnId), select: 'game_id,opp_team_id,pts,opp_pts,lead_pct,lead_changes,largest_lead,max_run', limit: GAME_LIMIT }, TTL, true),
        pro ? proGames(league, season) : Promise.resolve(null),
    ]);
    const flow: FlowRead[] = rows.map((r) => ({ game_id: String(r.game_id), opp_team_id: num(r.opp_team_id), pts: num(r.pts), opp_pts: num(r.opp_pts), lead_pct: num(r.lead_pct), lead_changes: num(r.lead_changes), largest_lead: num(r.largest_lead), max_run: num(r.max_run) }));
    const pick = ({ lead_pct, lead_changes, largest_lead, max_run }: FlowRead): FlowRow => ({ lead_pct, lead_changes, largest_lead, max_run });
    if (toEspn) return new Map(flow.flatMap((f) => (toEspn.has(f.game_id) ? [[toEspn.get(f.game_id)!, pick(f)] as const] : [])));
    // ponytail: college joins on (opponent, score) because the contest id has no ESPN crosswalk here; ambiguous matches are dropped
    const out = new Map<string, FlowRow>();
    for (const g of games) {
        if (g.teamScore === null || g.oppScore === null) continue;
        const hits = flow.filter((f) => f.opp_team_id === g.oppId && f.pts === g.teamScore && f.opp_pts === g.oppScore);
        if (hits.length === 1) out.set(g.gameId, pick(hits[0]));
    }
    return out;
}
