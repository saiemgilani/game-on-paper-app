// /<league>/game/[id], topology B: the Data API first (an ingested final never touches ESPN), then
// ESPN's cdn for status and header, then the processor for a live or un-ingested game.
import type { AstroGlobal } from 'astro';
import { DateTime } from 'luxon';
import { BASKETBALL } from '../../basketball/config';
import { gameHref } from '../../nba/links';
import { retrieveNbaGameRows, retrieveNbaProcessedGame, retrieveNbaSchedule } from '../../resources/nbaGames';
import { fromDataApi, fromProcessor, isTrue, requiredPeriods, scheduleRegulation, type DataApiGameRows, type NbaGame } from '../../resources/nbaGame';
import { ESPN_INVALID_GAME_STATUS_NAMES, retrieveGamePageGuarded, type ESPNPlayByPlayResponse } from '../../resources/espn';
import { ProcessorError, retrieveGameSources } from '../../resources/python';
import { retrieveGameShotQuality } from '../../resources/shotQuality';
import { getBasketballGameCacheConfig } from '../../utils/config';
import { isFeatureEnabled } from '../../utils/features';
import { SOURCE_PARAM } from '../../utils/adminView';
import { gameTeams, type GameShotQuality } from '../../utils/shotQuality';
import { gopStorage } from '../../utils/telemetry';
import type { BasketballLeague } from '../../utils/league';
import { retrieveImpactBox, type ImpactBoxReads } from '../../resources/impactBox';
import { retrieveGameFlow, type GameFlowReads } from '../../resources/gameFlow';
import { hasEpv, retrieveEpvBox, type EpvBoxReads } from '../../resources/epvBox';
import { retrieveRatedPrior, type RatedPrior } from '../../resources/pregameProjection';
import { retrieveGarbageTime, type GarbageReads } from '../../resources/garbageTime';
import { leagueContextFromRows } from '../../nba/adapters';
import type { LeagueContext } from '../../nba/dashboard';
import { retrieveGameExpected } from '../../resources/gameExpected';
import { retrieveGameInfo } from '../../resources/gameInfo';
import { retrieveGameStints, retrieveShiftReads, type GameStints, type ShiftReads } from '../../resources/gameStints';
import { retrieveLeagueContextRows } from '../../resources/nbaShots';
import { PROPS_LEAGUES, retrievePlayerProps, type PropRow } from '../../resources/playerProps';
import { retrievePlayerSeasonRates, type PlayerSeasonRate } from '../../resources/playerSeasonRates';
import { retrieveSeasonAverages } from '../../resources/seasonAverages';
import { retrieveTeamGridFinal, retrieveTeamGridSeason, type TeamGridSeason, retrieveTeamGridGame } from '../../resources/teamGrid';
import type { GameInfoReads } from '../../utils/gameInfo';
import type { SeasonAverage } from '../../utils/gameLeaders';
import { retrieveGameLine, settled } from '../../resources/gameLines';
import type { GameLine } from '../../utils/gameLines';
import { built, retrieveWpLenses } from '../../resources/wpLenses';
import type { WpLensRow } from '../../utils/wpLenses';
import { seasonCache, setCache, uncacheable } from './cache';
import { retrieveGameSituational } from '../../resources/situational';
import { parseSituation, situationsFor, type GameSituationsTab } from '../../utils/situations';

/** BB-G18's pregame card: the game's `rated_priors` row as published, with its prediction present. */
export type PregameProjection = RatedPrior & { exp_home_margin: number; rated_home_prob: number };

/** The admin source tool's data (components/nba/game/NbaAdminSourceTools.astro); only an admin on the 'source-switch' path gets it. */
export interface BasketballSourceTools {
    /** the contract's registry for the league, ESPN first, from GET /<league>/<id>/sources; ['espn'] when it cannot answer */
    sources: string[]
    /** the `?source=` the page was asked for; null without one (the public render: the Data API for an ingested final) */
    selected: string | null
    /** the ESPN processor payload to compare against, only when another source was selected; null when it failed */
    espn: NbaGame | null
}

export type BasketballGamePrep = { notFound: true } | { unavailable: true } | { pregame: true; espnGame: ESPNPlayByPlayResponse } | {
    game: NbaGame;
    sourceTools?: BasketballSourceTools;
    /** BB-G25, only with 'bball-situational' on and a final: the Situations panel; `reads` null when a read failed */
    situations?: GameSituationsTab;
    /** BB-G15, 'bball-poe' on and an ingested final only; null: the read failed */
    poe?: GameShotQuality | null;
    /** BB-G1, only with 'bball-impact-box' on and a final; null when a read failed (the panel says so) */
    impact?: ImpactBoxReads | null;
    /** BB-G28, only with 'bball-game-flow' on and a final; null when its read failed (the lead chart still draws) */
    flow?: GameFlowReads | null;
    /** BB-G26, only with 'bball-epv' on and an NBA final from 2021-22; null when a read failed (the panel says so) */
    epv?: EpvBoxReads | null;
    /** BB-G18, only with 'bball-pregame-projection' on; null when the read failed or a side has no rating (no card) */
    projection?: PregameProjection | null;
    /** BB-G2, only with 'bball-garbage-time' and 'bball-impact-box' on and a final; `reads` null when the log's read failed */
    garbage?: { reads: GarbageReads | null; out: boolean };
    /** BB-G35, only with 'bball-game-leaders' on and a final; null when the read failed (the panel says so) */
    averages?: SeasonAverage[] | null;
    /** BB-G39, only with 'bball-game-shooting' on and a final: the season's league curve; null when its read failed */
    shooting?: LeagueContext | null;
    /** BB-G38, only with 'bball-shot-filters' on, live or final: a final's stints (ON/OFF); null for a live game or a failed read */
    shotFilters?: { stints: GameStints | null };
    /** BB-G36, only with 'bball-shift-chart' on and a final: the game's mapped stints and minutes; null when the read failed */
    shift?: ShiftReads | null;
    /** BB-G32, only with 'bball-team-grid' on, live or final (a final adds `game`, its counted rows); null when a read failed (the grid draws without it) */
    season?: TeamGridSeason | null;
    /** BB-G34, only with 'bball-player-box-views' on, live or final; null when its read failed (Vs average says so) */
    playerSeason?: PlayerSeasonRate[] | null;
    /** BB-G42, only with 'bball-game-info' on, live or final; null when a read failed (the panel says so) */
    info?: GameInfoReads | null;
    /** BB-G44, only with 'bball-props' on, nba/wnba/mbb, a final or live game; null when its read failed */
    playerProps?: PropRow[] | null;
    /** BB-G43, only with 'bball-lines' on, live or final, and only when the game has a row; null when the read failed */
    lines?: GameLine | null;
};

/**
 * The game page's Situations panel (BB-G25 review, Q27), for a final only (the producer's per-game rows are built from
 * finals). Off, or not final: undefined, and nothing is read. A failed read keeps the page and is never cached; a Data API
 * final with no rows yet (the nightly per-game build has not reached it) is held for the season pages' 6 hours, not the
 * final's year, so the panel fills once the rows land.
 */
async function withSituations<T extends { game: NbaGame }>(Astro: AstroGlobal, league: BasketballLeague, prep: T): Promise<T & { situations?: GameSituationsTab }> {
    const { game } = prep;
    if (!isFeatureEnabled('bball-situational', Astro.locals) || !game.status.completed || game.season == null) return prep;
    const options = situationsFor(league, game.season);
    const situation = parseSituation(Astro.url.searchParams.get('situation'), options);
    try {
        const reads = await retrieveGameSituational(league, game.season, game.id, game.home.team.id, game.away.team.id);
        if (game.source === 'data_api' && reads.home.length === 0 && reads.away.length === 0) setCache(Astro, seasonCache(league));
        return { ...prep, situations: { situation, options, reads } };
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} game ${game.id} situational splits: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { ...prep, situations: { situation, options, reads: null } };
    }
}

/** BB-G43: how long after the game a final without a settled market row is still re-read on the nightly's window (a season). */
export const LINES_RECENT_MS = 200 * 24 * 60 * 60 * 1000;

/** BB-G2's toggle: `?garbage=out` leaves the garbage-time possessions out; read only with 'bball-garbage-time' on. */
export const GARBAGE_PARAM = 'garbage';

/**
 * The registry and, for a non-ESPN selection, the ESPN side of the compare -- the ordinary no-`source` processor request,
 * the same cache entry a public render of a live or un-ingested game fills. Fail-open: a missing registry is ESPN alone, a
 * failed ESPN side an empty column, never a failed page.
 */
async function sourceTools(id: string, league: BasketballLeague, cacheTTL: number, source: string | undefined): Promise<BasketballSourceTools> {
    const selected = source ?? null;
    const [registry, espn] = await Promise.all([
        retrieveGameSources(id, league),
        !selected || selected === 'espn' ? null : retrieveNbaProcessedGame(id, cacheTTL, league).then((j) => fromProcessor(j, league)).catch(() => null),
    ]);
    return { sources: registry?.sources ?? ['espn'], selected, espn };
}

const ID = /^\d{6,12}$/;
/** Only a Data API-served final is immutable; a processor-served one gets a day (getBasketballGameCacheConfig). */
const finalCache = (league: BasketballLeague) => ({ maxAge: 60 * 60 * 24 * 7 * 52, tags: ['game-completed', league] });
/** ESPN logs late free throws after the feed is "done", so the pbp can end a point or two short of the final. */
const SCORE_TOLERANCE = 3;

/** The clause an ingested game fails, or null. Guards against hoopR's known ESPN pathologies. */
export function sanityGate(rows: DataApiGameRows, league: BasketballLeague): string | null {
    const s = rows.schedule[0];
    if (!s) return 'schedule: no row';
    const periods = requiredPeriods(s, scheduleRegulation(s, league).periods);
    const last = [...rows.pbp].sort((a, b) => Number(a.game_play_number) - Number(b.game_play_number)).at(-1);
    if (!last) return 'pbp: no plays';
    const seen = new Set(rows.pbp.map((p) => Number(p.period_number)));
    for (let q = 1; q <= periods; q++) if (!seen.has(q)) return `pbp: no plays in period ${q}`;
    if (!(Number(last.period_number) >= periods)) return `pbp: last play is in period ${last.period_number} of ${periods}`;
    const off = (a: unknown, b: unknown) => !(Math.abs(Number(a) - Number(b)) <= SCORE_TOLERANCE); // NaN fails
    if (off(last.home_score, s.home_score) || off(last.away_score, s.away_score)) return 'pbp: last play is far from the final score';
    if (rows.team_box.length !== 2) return `team_box: ${rows.team_box.length} rows`;
    for (const tid of [s.home_id, s.away_id]) if (rows.player_box.filter((p) => Number(p.team_id) === Number(tid)).length < 5) return `player_box: fewer than five rows for team ${tid}`;
    if (rows.play_wp.length !== rows.pbp.length) return `play_wp: ${rows.play_wp.length} rows for ${rows.pbp.length} plays`;
    if (rows.game_team_rates.length !== 2) return `game_team_rates: ${rows.game_team_rates.length} rows`;
    if (rows.game_player_rates.length !== rows.player_box.length) return `game_player_rates: ${rows.game_player_rates.length} rows for ${rows.player_box.length} player_box rows`;
    return null;
}

function degraded(id: string, message: string, league: BasketballLeague): void {
    const gop = gopStorage.getStore();
    if (!gop) return;
    gop.render_outcome = 'degraded';
    gop.events.push({ table: 'error_log', row: { service: 'astro', level: 'warn', message: message.slice(0, 500), stack: null, path: gameHref(league, id), game_id: id, context: null } });
}

export async function prepareBasketballGame(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballGamePrep> {
    const r = await prepareGame(Astro, league);
    // BB-G42's Game info and BB-G43's Lines and markets, live or final (the pregame page reads its own)
    const withInfo = isFeatureEnabled('bball-game-info', Astro.locals);
    const withLines = isFeatureEnabled('bball-lines', Astro.locals);
    // BB-G45's WP lenses: a Data API final's play_wp variants, read beside the final's panels; flag off is today's page. Only
    // the Data API's plays share play_wp's game_play_number (the same ingest); a processor-served game keeps our model alone.
    const withLenses = 'game' in r && r.game.source === 'data_api' && r.game.status.completed && r.game.season != null && isFeatureEnabled('bball-wp-lenses', Astro.locals);
    if (!('game' in r) || (!withInfo && !withLines && !withLenses)) return finalPanels(Astro, league, r);
    const game = r.game;
    const [p, info, read, rows] = await Promise.all([
        finalPanels(Astro, league, r),
        withInfo ? retrieveGameInfo(league, game).catch((e: any) => {
            console.error(`ERROR while loading the ${league} game info for game ${game.id}: ${e}, ${e?.stack}`);
            return null;
        }) : undefined,
        withLines ? retrieveGameLine(league, game.season, game.id).then((row) => ({ row }), (e: any) => {
            console.error(`ERROR while loading the ${league} game lines for game ${game.id}: ${e}, ${e?.stack}`);
            return null;
        }) : undefined,
        withLenses ? readWpLenses(league, game, game.season as number) : undefined,
    ]);
    // decorative like the final's panels: a failed read is never cached. An ingested final's season profiles (Game info) move
    // with the nightly products, and so does a recent final with no settled market row yet (the current season's are mostly
    // unmapped): each follows the nightly's window, unless a panel's failed read (a null) already made it uncacheable.
    // ponytail: "recent" is the game date within LINES_RECENT_MS, not the season; an older unmapped game keeps its year
    const failed = Object.values(p).some((x) => x === null || (x && typeof x === 'object' && 'reads' in x && x.reads === null));
    const recent = Date.now() - Date.parse(game.date) < LINES_RECENT_MS;
    if (info === null || read === null || rows === null) uncacheable(Astro);
    else if (game.source === 'data_api' && !failed && (info !== undefined || (read !== undefined && recent && !settled(read.row)) || (rows !== undefined && !built(rows)))) setCache(Astro, seasonCache(league));
    const lines = read === null ? null : read?.row ?? undefined;
    // BB-G45: an ingested final whose season the nightly has not rebuilt with the variants yet (sdv-db #217's backfill) waits too
    const q = p as Extract<BasketballGamePrep, { game: NbaGame }>;
    return { ...q, ...(rows && built(rows) ? { game: { ...q.game, wpLenses: rows } } : {}), ...(info !== undefined ? { info } : {}), ...(lines !== undefined ? { lines } : {}) };
}

/** BB-G45's variant rows; null when the read failed (the chart keeps our model alone). */
async function readWpLenses(league: BasketballLeague, game: NbaGame, season: number): Promise<WpLensRow[] | null> {
    try {
        return await retrieveWpLenses(league, season, game.id);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} WP lenses for game ${game.id}: ${e}, ${e?.stack}`);
        return null;
    }
}

/** The final's panels (BB-G1, BB-G28, BB-G2): read only once a final will render. */
async function finalPanels(Astro: AstroGlobal, league: BasketballLeague, r: BasketballGamePrep): Promise<BasketballGamePrep> {
    // BB-G18: a pregame page with the flag on spends one season ratings read; off, nothing is read and the page is today's
    if ('pregame' in r) {
        if (!isFeatureEnabled('bball-pregame-projection', Astro.locals)) return r;
        return { ...r, projection: await readProjection(Astro, league, r.espnGame) };
    }
    if (!('game' in r)) return r;
    // BB-G38's shot filters draw on a live game too; only their ON/OFF filter reads, and only a final's stints
    const withStints = isFeatureEnabled('bball-shot-filters', Astro.locals);
    const live = withStints ? { shotFilters: { stints: null } } : {};
    // read only once a game will render: a 404, 503 or pregame page never spends the reads, and flag off is today's page.
    // The producer's tables are per season, so a game with no season has nothing to read (no panel, not "unavailable").
    if (r.game.season == null) return { ...r, ...live };
    // BB-G32's season context reads live too (the season table, not the game's); every other panel waits for the final
    const withGrid = isFeatureEnabled('bball-team-grid', Astro.locals);
    // BB-G34's Vs average is per minute, so it reads live too (points so far against minutes so far)
    const withViews = isFeatureEnabled('bball-player-box-views', Astro.locals);
    const final = r.game.status.completed;
    const withImpact = final && isFeatureEnabled('bball-impact-box', Astro.locals);
    const withFlow = final && isFeatureEnabled('bball-game-flow', Astro.locals);
    const withEpv = final && isFeatureEnabled('bball-epv', Astro.locals) && hasEpv(league, r.game.season);
    // the toggle sits beside the Impact box: no box, no toggle and no read
    const withGarbage = withImpact && isFeatureEnabled('bball-garbage-time', Astro.locals);
    const withLeaders = final && isFeatureEnabled('bball-game-leaders', Astro.locals);
    const withShooting = final && isFeatureEnabled('bball-game-shooting', Astro.locals);
    const withFinalStints = final && withStints;
    const withShift = final && isFeatureEnabled('bball-shift-chart', Astro.locals);
    // BB-G33's expected points: the processor payload carries them, so only a Data API final reads {lg}.game_team_expected
    const withExpected = final && r.game.source === 'data_api' && isFeatureEnabled('bball-situational-box', Astro.locals);
    // BB-G33 review Q23: a final with no splits shows the producer's situational rows; the grid's final read carries them
    const withSituational = final && !r.game.home.splits && !r.game.away.splits && !withGrid && isFeatureEnabled('bball-situational-box', Astro.locals);
    // BB-G37's units and on/off ride the Impact box's reads (its ids and names): no box, no read
    const withInGame = withImpact && isFeatureEnabled('bball-ingame-lineups', Astro.locals);
    const withProps = PROPS_LEAGUES.includes(league) && isFeatureEnabled('bball-props', Astro.locals);
    if (!withImpact && !withFlow && !withShooting && !withFinalStints && !withShift && !withLeaders && !withEpv && !withGrid && !withExpected && !withSituational && !withViews && !withProps) return { ...r, ...live };
    const [impact, flow, epv, garbage, averages, shooting, stints, shift, season, expected, counted, playerSeason, playerProps] = await Promise.all([
        withImpact ? readPanel('impact box', league, r.game, r.game.season, (l, s, g, h, a) => retrieveImpactBox(l, s, g, h, a, withInGame)) : undefined,
        withFlow ? readPanel('game flow', league, r.game, r.game.season, retrieveGameFlow) : undefined,
        withEpv ? readPanel('EPV box', league, r.game, r.game.season, retrieveEpvBox) : undefined,
        withGarbage ? readPanel('garbage-time log', league, r.game, r.game.season, retrieveGarbageTime) : undefined,
        withLeaders ? readPanel('season averages', league, r.game, r.game.season, retrieveSeasonAverages) : undefined,
        withShooting ? readPanel('league shot context', league, r.game, r.game.season, (lg, season) => retrieveLeagueContextRows(season, lg).then(leagueContextFromRows)) : undefined,
        withFinalStints ? readPanel('game stints', league, r.game, r.game.season, retrieveGameStints) : undefined,
        withShift ? readPanel('shift chart', league, r.game, r.game.season, retrieveShiftReads) : undefined,
        // a final adds its counted rows (possessions and ratings), so the game row and the season row share one definition
        withGrid ? readPanel('team grid', league, r.game, r.game.season, final ? retrieveTeamGridFinal : retrieveTeamGridSeason) : undefined,
        withExpected ? readPanel('game expected points', league, r.game, r.game.season, retrieveGameExpected) : undefined,
        withSituational ? readPanel('situational rows', league, r.game, r.game.season, retrieveTeamGridGame) : undefined,
        withViews ? readPanel('player season rates', league, r.game, r.game.season, retrievePlayerSeasonRates) : undefined,
        withProps ? readPanel('player props', league, r.game, r.game.season, retrievePlayerProps) : undefined,
    ]);
    // the panels are decorative: a failed read renders the rest of the page, never cached; a final the nightly products have
    // not reached yet is held for the season pages' window, not the Data API final's year
    if (impact === null || impact?.inGame === null || flow === null || epv === null || garbage === null || season === null || shooting === null || stints === null || shift === null || averages === null || expected === null || counted === null || playerSeason === null || playerProps === null) uncacheable(Astro);
    // season averages move with every game (and arrive after it): a final that reads them follows the nightly ingest too
    // a season with no league curve yet (fgPct null: no total row) draws no signature: held for the season window too; so is a
    // recent final with no stints yet (the nightly build), not an old one (stints start with recent seasons: never coming)
    // (BB-G37's units can land a night after the impact rows: no units yet is the season window too)
    else if (r.game.source === 'data_api' && (impact?.players.length === 0 || impact?.inGame?.units.length === 0 || (flow && !flow.home && !flow.away) || season !== undefined || shooting?.fgPct === null || (((stints && Object.keys(stints).length === 0) || shift?.stints.length === 0) && recentFinal(r.game)) || averages !== undefined || (expected && (!expected.home || !expected.away)) || (counted && !counted.home.length) || (epv && (epv.players.length === 0 || epv.team.length < 2 || epv.plays.length === 0)) || playerSeason !== undefined || playerProps?.length === 0)) setCache(Astro, seasonCache(league));
    // the rows ride on the sides, where a processor game already has them
    // a final with no splits: each side's situational rows (Q23), from the grid's read or its own
    const sit = r.game.home.splits || r.game.away.splits ? undefined : (season?.game ?? counted ?? undefined);
    const ride = (s: 'home' | 'away') => ({ ...r.game[s], ...(expected?.[s] ? { expected: expected[s] } : {}), ...(sit?.[s].length ? { situational: sit[s] } : {}) });
    const game = expected || sit ? { ...r.game, home: ride('home'), away: ride('away') } : r.game;
    return { ...r, game, ...(impact !== undefined ? { impact } : {}), ...(flow !== undefined ? { flow } : {}), ...(epv !== undefined ? { epv } : {}),
        ...(garbage !== undefined ? { garbage: { reads: garbage, out: Astro.url.searchParams.get(GARBAGE_PARAM) === 'out' } } : {}),
        ...(season !== undefined ? { season } : {}), ...(shooting !== undefined ? { shooting } : {}),
        ...(withStints ? { shotFilters: { stints: stints ?? null } } : {}), ...(shift !== undefined ? { shift } : {}),
        ...(averages !== undefined ? { averages } : {}), ...(playerSeason !== undefined ? { playerSeason } : {}),
        ...(playerProps !== undefined ? { playerProps } : {}) };
}

/**
 * The pregame card's data: the game's `rated_priors` row by the ESPN season and game id, as published. null (no card) when
 * the producer has no row (a preseason game), its prediction is null (a pro side yet to play), its home side is not ESPN's,
 * or the read failed; a failed read is never held. No hold for the college prior: the producer's college rating already
 * blends it in.
 */
async function readProjection(Astro: AstroGlobal, league: BasketballLeague, espnGame: ESPNPlayByPlayResponse): Promise<PregameProjection | null> {
    const header = espnGame.gamepackageJSON.header;
    const comp: any = header.competitions[0];
    const season = Number(header.season?.year);
    if (!Number.isInteger(season)) return null;
    let row: RatedPrior | null;
    try {
        row = await retrieveRatedPrior(league, season, String(espnGame.gameId));
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} rated prior for game ${espnGame.gameId}: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return null;
    }
    const espnHome = comp.competitors.find((c: any) => c.homeAway === 'home')?.team?.id;
    if (!row || String(row.home_team_id) !== String(espnHome)) return null;
    const ok = (x: number | null): x is number => x != null && Number.isFinite(x);
    return ok(row.exp_home_margin) && ok(row.rated_home_prob) ? row as PregameProjection : null;
}


/** A final from the last three days: the nightly season products (game_stints) may not have reached it yet. */
const recentFinal = (game: NbaGame): boolean => Date.now() - Date.parse(game.date) < 3 * 24 * 60 * 60 * 1000;

/** A game panel's reads (BB-G1's Impact box, BB-G28's Game flow, BB-G26's EPV box, BB-G44's player lines) by the season and the ESPN ids; null when any failed. */
async function readPanel<T>(what: string, league: BasketballLeague, game: NbaGame, season: number,
    read: (league: BasketballLeague, season: number, espnGameId: string, homeId: number, awayId: number) => Promise<T>): Promise<T | null> {
    try {
        return await read(league, season, game.id, Number(game.home.team.id), Number(game.away.team.id));
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${what} for game ${game.id}: ${e}, ${e?.stack}`);
        return null;
    }
}

async function prepareGame(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballGamePrep> {
    Astro.locals.league = league;
    const cfg = BASKETBALL[league];
    const id = Astro.params.id ?? '';
    if (!ID.test(id)) { uncacheable(Astro); return { notFound: true }; }

    // 'source-switch' (preview) AND an admin session, as on the football game page (routes/game.ts). For every other viewer
    // nothing here is read: the reads, the processor request and its cache key are today's. An admin render is uncacheable
    // already (middleware withPreviewCacheGuard).
    const sourceSwitch = isFeatureEnabled('source-switch', Astro.locals) && Astro.locals.adminAuthed === true;
    const source = sourceSwitch ? Astro.url.searchParams.get(SOURCE_PARAM) || undefined : undefined;

    let fellThrough = false;
    // 1. the Data API knows the game and says it is final: render from it, no ESPN. An explicit `?source=` skips it: the
    // warehouse is ESPN's play-by-play, so serving it would hide the feed the admin asked for.
    try {
        const row = source ? null : await retrieveNbaSchedule(id, league);
        if (isTrue(row?.status_type_completed)) {
            // a failed read of an ingested final is not "not ingested": record it, or a broken
            // nightly stage would quietly send every final back through ESPN
            let rows: DataApiGameRows | null = null;
            let bad: string | null;
            try { rows = await retrieveNbaGameRows(id, league); bad = sanityGate(rows, league); }
            catch (e: any) { bad = `rows read failed: ${e?.message ?? e}`; }
            if (!bad && rows) {
                try {
                    const game = fromDataApi(rows, league); // before setCache: an adapter throw falls through like a gate failure
                    setCache(Astro, finalCache(league));
                    // BB-G15: shot quality is built at the ingest tail, so only an ingested final reads it; flag off, no read
                    const poe = isFeatureEnabled('bball-poe', Astro.locals) ? { poe: await readGamePoe(id, game, league) } : {};
                    if (poe.poe === null) uncacheable(Astro); // decorative: a failed read keeps the page, never cached
                    return withSituations(Astro, league, sourceSwitch ? { game, sourceTools: await sourceTools(id, league, 0, undefined), ...poe } : { game, ...poe });
                } catch (e: any) { bad = `adapter: ${e?.message ?? e}`; }
            }
            fellThrough = true;
            degraded(id, `Data API sanity gate failed (${bad}); falling through to the processor`, league);
        }
    } catch (e: any) {
        console.warn(`${league} game ${id}: Data API unavailable (${e?.message ?? e}); falling through to ESPN`);
    }

    // 2. ESPN's cdn page for status and header
    let espnGame: ESPNPlayByPlayResponse | null = null;
    let regressed = false;
    let espnFailed = false;
    try {
        const guarded = await retrieveGamePageGuarded(id, league);
        espnGame = guarded.page;
        // the guard swallows a failed fetch and may hand back KV's last copy: render that, never hold it
        espnFailed = guarded.fetchFailed === true;
        regressed = guarded.regressed || (espnFailed && espnGame != null);
        if (regressed) degraded(id, `stale ESPN payload: ${guarded.reason}`, league);
    } catch (e: any) {
        console.error(`${league} game ${id}: ESPN failed: ${e?.message ?? e}`);
        espnFailed = true;
    }
    // an outage is a 503, never a 404 that tells a crawler the game does not exist
    if (!espnGame) { uncacheable(Astro); return espnFailed ? { unavailable: true } : { notFound: true }; }
    const comp = (espnGame as any)?.gamepackageJSON?.header?.competitions?.[0];
    if (!comp?.status?.type) { uncacheable(Astro); return { notFound: true }; }
    const config = getBasketballGameCacheConfig(comp.date, comp.status, cfg.scoreboardRefresh, league);
    const espnCompleted = comp.status.type.completed === true;
    // a regressed payload is rendered (nothing fresher exists) but never held
    const cache = () => (regressed ? uncacheable(Astro) : setCache(Astro, config as any));
    if (['STATUS_SCHEDULED', 'STATUS_DELAYED'].includes(comp.status.type.name) || ESPN_INVALID_GAME_STATUS_NAMES.includes(comp.status.type.name)) {
        cache();
        return { pregame: true, espnGame };
    }

    // 3. live, or final but not ingested: the processor
    try {
        const ttl = config.maxAge || 30;
        const [payload, tools] = await Promise.all([
            // an admin source request holds a minute at most: a failed-over (ESPN) answer must not outlive the outage by a day
            retrieveNbaProcessedGame(id, source ? Math.min(ttl, 60) : ttl, league, source),
            sourceSwitch ? sourceTools(id, league, ttl, source) : undefined,
        ]);
        const game = fromProcessor(payload, league);
        // a sanity-gate fall-through must not be pinned, nor a live payload the processor cached
        // moments before ESPN called the game final (it would read "LIVE" for the final's day)
        if (fellThrough || (espnCompleted && !game.status.completed)) uncacheable(Astro); else cache();
        return withSituations(Astro, league, tools ? { game, sourceTools: tools } : { game });
    } catch (e: any) {
        // a 404 is "no plays yet" only before the game ends; on a final it is a broken payload
        if (e instanceof ProcessorError && e.status === 404 && !espnCompleted) { cache(); return { pregame: true, espnGame }; }
        console.error(`${league} game ${id}: processor failed: ${e?.message ?? e}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
}

/** BB-G15: the game's two team rows. No pair (a playoff game, the model's warm-up season) is `{}`; a failed read is null. */
async function readGamePoe(id: string, game: NbaGame, league: BasketballLeague): Promise<GameShotQuality | null> {
    const cfg = BASKETBALL[league];
    if (game.season == null) return {};
    // college keys the tables by ESPN's game id; the NBA/WNBA by the stats id, so the read is the game's day in the league's zone
    const by = cfg.currentMembers ? { gameId: id } : { date: DateTime.fromISO(game.date, { zone: 'utc' }).setZone(cfg.scoreboardTimeZone).toISODate() ?? game.date.slice(0, 10) };
    try {
        return gameTeams(await retrieveGameShotQuality(league, game.season, by), league, Number(game.home.team.id), Number(game.away.team.id)) ?? {};
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} game ${id} shot quality: ${e}, ${e?.stack}`);
        return null;
    }
}
