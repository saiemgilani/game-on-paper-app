// /<league>/game/[id], topology B: the Data API first (an ingested final never touches ESPN), then
// ESPN's cdn for status and header, then the processor for a live or un-ingested game.
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { gameHref } from '../../nba/links';
import { retrieveNbaGameRows, retrieveNbaProcessedGame, retrieveNbaSchedule } from '../../resources/nbaGames';
import { fromDataApi, fromProcessor, isTrue, requiredPeriods, scheduleRegulation, type DataApiGameRows, type NbaGame } from '../../resources/nbaGame';
import { ESPN_INVALID_GAME_STATUS_NAMES, retrieveGamePageGuarded, type ESPNPlayByPlayResponse } from '../../resources/espn';
import { ProcessorError, retrieveGameSources } from '../../resources/python';
import { getBasketballGameCacheConfig } from '../../utils/config';
import { isFeatureEnabled } from '../../utils/features';
import { SOURCE_PARAM } from '../../utils/adminView';
import { gopStorage } from '../../utils/telemetry';
import type { BasketballLeague } from '../../utils/league';
import { retrieveImpactBox, type ImpactBoxReads } from '../../resources/impactBox';
import { seasonCache, setCache, uncacheable } from './cache';

/** The admin source tool's data (components/nba/game/NbaAdminSourceTools.astro); only an admin on the 'source-switch' path gets it. */
export interface BasketballSourceTools {
    /** the contract's registry for the league, ESPN first, from GET /<league>/<id>/sources; ['espn'] when it cannot answer */
    sources: string[]
    /** the `?source=` the page was asked for; null without one (the public render: the Data API for an ingested final) */
    selected: string | null
    /** the ESPN processor payload to compare against, only when another source was selected; null when it failed */
    espn: NbaGame | null
}

export type BasketballGamePrep = { notFound: true } | { unavailable: true } | { pregame: true; espnGame: ESPNPlayByPlayResponse }
    /** `impact`: BB-G1, only with 'bball-impact-box' on and a final; null when a read failed (the panel says so) */
    | { game: NbaGame; sourceTools?: BasketballSourceTools; impact?: ImpactBoxReads | null };

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
    // read only once a final will render: a 404, 503, pregame or live page never spends the reads, and flag off is today's page.
    // The producer's tables are per season, so a game with no season has nothing to read (no panel, not "unavailable").
    if (!('game' in r) || !r.game.status.completed || r.game.season == null || !isFeatureEnabled('bball-impact-box', Astro.locals)) return r;
    const impact = await readImpact(league, r.game, r.game.season);
    // the panel is decorative: a failed read renders the rest of the page, never cached; a final the nightly products have
    // not reached yet is held for the season pages' window, not the Data API final's year
    if (impact === null) uncacheable(Astro);
    else if (impact.players.length === 0 && r.game.source === 'data_api') setCache(Astro, seasonCache(league));
    return { ...r, impact };
}

/** The Impact box's reads (BB-G1); null when any failed. */
async function readImpact(league: BasketballLeague, game: NbaGame, season: number): Promise<ImpactBoxReads | null> {
    try {
        return await retrieveImpactBox(league, season, game.id, Number(game.home.team.id), Number(game.away.team.id));
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} impact box for game ${game.id}: ${e}, ${e?.stack}`);
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
                    return sourceSwitch ? { game, sourceTools: await sourceTools(id, league, 0, undefined) } : { game };
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
        return tools ? { game, sourceTools: tools } : { game };
    } catch (e: any) {
        // a 404 is "no plays yet" only before the game ends; on a final it is a broken payload
        if (e instanceof ProcessorError && e.status === 404 && !espnCompleted) { cache(); return { pregame: true, espnGame }; }
        console.error(`${league} game ${id}: processor failed: ${e?.message ?? e}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
}
