// /nba/game/[id], topology B: the Data API first (an ingested final never touches ESPN), then
// ESPN's cdn for status and header, then the processor for a live or un-ingested game.
import type { AstroGlobal } from 'astro';
import { retrieveNbaGameRows, retrieveNbaProcessedGame, retrieveNbaSchedule } from '../../resources/nbaGames';
import { fromDataApi, fromProcessor, type DataApiGameRows, type NbaGame } from '../../resources/nbaGame';
import { ESPN_INVALID_GAME_STATUS_NAMES, retrieveGamePageGuarded, type ESPNPlayByPlayResponse } from '../../resources/espn';
import { ProcessorError } from '../../resources/python';
import { getNbaGameCacheConfig } from '../../utils/config';
import { gopStorage } from '../../utils/telemetry';
import { setCache, uncacheable } from './cache';

export type NbaGamePrep = { notFound: true } | { unavailable: true } | { pregame: true; espnGame: ESPNPlayByPlayResponse } | { game: NbaGame };

const ID = /^\d{6,12}$/;
/** Only a Data API-served final is immutable; a processor-served one gets a day (getNbaGameCacheConfig). */
const FINAL_CACHE = { maxAge: 60 * 60 * 24 * 7 * 52, tags: ['game-completed', 'nba'] };
/** ESPN logs late free throws after the feed is "done", so the pbp can end a point or two short of the final. */
const SCORE_TOLERANCE = 3;

/** The clause an ingested game fails, or null. Guards against hoopR's known ESPN pathologies. */
export function sanityGate(rows: DataApiGameRows): string | null {
    const s = rows.schedule[0];
    if (!s) return 'schedule: no row';
    const periods = Math.max(4, Number(s.status_period ?? 4) || 4);
    const last = [...rows.pbp].sort((a, b) => Number(a.game_play_number) - Number(b.game_play_number)).at(-1);
    if (!last) return 'pbp: no plays';
    if (Number(last.period_number) < periods) return `pbp: last play is in period ${last.period_number} of ${periods}`;
    if (Math.abs(Number(last.home_score) - Number(s.home_score)) > SCORE_TOLERANCE || Math.abs(Number(last.away_score) - Number(s.away_score)) > SCORE_TOLERANCE) return 'pbp: last play is far from the final score';
    if (rows.team_box.length !== 2) return `team_box: ${rows.team_box.length} rows`;
    for (const tid of [s.home_id, s.away_id]) if (rows.player_box.filter((p) => Number(p.team_id) === Number(tid)).length < 5) return `player_box: fewer than five rows for team ${tid}`;
    if (rows.play_wp.length !== rows.pbp.length) return `play_wp: ${rows.play_wp.length} rows for ${rows.pbp.length} plays`;
    if (rows.game_team_rates.length !== 2) return `game_team_rates: ${rows.game_team_rates.length} rows`;
    if (rows.game_player_rates.length !== rows.player_box.length) return `game_player_rates: ${rows.game_player_rates.length} rows for ${rows.player_box.length} player_box rows`;
    return null;
}

function degraded(id: string, message: string): void {
    const gop = gopStorage.getStore();
    if (!gop) return;
    gop.render_outcome = 'degraded';
    gop.events.push({ table: 'error_log', row: { service: 'astro', level: 'warn', message: message.slice(0, 500), stack: null, path: `/nba/game/${id}`, game_id: id, context: null } });
}

export async function prepareNbaGame(Astro: AstroGlobal): Promise<NbaGamePrep> {
    Astro.locals.league = 'nba';
    const id = Astro.params.id ?? '';
    if (!ID.test(id)) { uncacheable(Astro); return { notFound: true }; }

    // 1. the Data API knows the game and says it is final: render from it, no ESPN
    try {
        const row = await retrieveNbaSchedule(id);
        if (row?.status_type_completed === true) {
            const rows = await retrieveNbaGameRows(id);
            const fail = sanityGate(rows);
            if (!fail) { setCache(Astro, FINAL_CACHE); return { game: fromDataApi(rows) }; }
            degraded(id, `Data API sanity gate failed (${fail}); falling through to the processor`);
        }
    } catch (e: any) {
        console.warn(`nba game ${id}: Data API unavailable (${e?.message ?? e}); falling through to ESPN`);
    }

    // 2. ESPN's cdn page for status and header
    let espnGame: ESPNPlayByPlayResponse | null = null;
    let regressed = false;
    try {
        const guarded = await retrieveGamePageGuarded(id, 'nba');
        espnGame = guarded.page;
        regressed = guarded.regressed;
        if (regressed) degraded(id, `stale ESPN payload: ${guarded.reason}`);
    } catch (e: any) {
        console.error(`nba game ${id}: ESPN failed: ${e?.message ?? e}`);
    }
    if (!espnGame) { uncacheable(Astro); return { notFound: true }; }
    const comp = espnGame.gamepackageJSON.header.competitions[0];
    const config = getNbaGameCacheConfig(comp.date, comp.status);
    // a regressed payload is rendered (nothing fresher exists) but never held
    const cache = () => (regressed ? uncacheable(Astro) : setCache(Astro, config as any));
    if (['STATUS_SCHEDULED', 'STATUS_DELAYED'].includes(comp.status.type.name) || ESPN_INVALID_GAME_STATUS_NAMES.includes(comp.status.type.name)) {
        cache();
        return { pregame: true, espnGame };
    }

    // 3. live, or final but not ingested: the processor
    try {
        const game = fromProcessor(await retrieveNbaProcessedGame(id, config.maxAge || 30));
        // a sanity-gate fall-through rendered from the processor must not be pinned either
        if (gopStorage.getStore()?.render_outcome === 'degraded') uncacheable(Astro); else cache();
        return { game };
    } catch (e: any) {
        if (e instanceof ProcessorError && e.status === 404) { cache(); return { pregame: true, espnGame }; }
        console.error(`nba game ${id}: processor failed: ${e?.message ?? e}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
}
