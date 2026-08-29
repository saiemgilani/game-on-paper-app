import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCurrentScoreboard, type ESPNScheduleEvent } from '../../../resources/espn';
import type { GameState } from '../../../utils/gameState';
import { kvAge, type LiveView } from '../../../utils/staleness';
import { CURRENT_SEASON_CONFIG, CACHE_TTL_MULTIPLIER } from '../../../utils/config';

export const prerender = false;

// Static route: wins over [name].ts, and is behind the same /admin basic auth.
// One ESPN scoreboard call per request, bypassing KV -- this IS the truth we
// measure the caches against. Reads KV but never writes it.

const view = (g: ESPNScheduleEvent): LiveView => {
    const c = g.competitions[0];
    const st = c?.status ?? g.status;
    return {
        period: st?.period ?? null,
        clock: st?.displayClock ?? null,
        scores: (c?.competitors ?? []).map((x: any) => Number(x?.score) || 0),
        state: st?.type?.state ?? 'unknown',
    };
};

export const GET: APIRoute = async () => {
    const now = Date.now();
    const kv = env.ESPN_API_CACHE;

    const [espn, cached] = await Promise.all([
        getCurrentScoreboard(false, false),
        kv.getWithMetadata<ESPNScheduleEvent[], { fetchedAt?: number }>('scoreboard', 'json').catch(() => null),
    ]);
    const kvGames = cached?.value ?? [];
    const kvById = new Map(kvGames.map((g) => [g.id, g]));
    const kvScoreboardAge = kvAge(cached?.metadata?.fetchedAt, now);

    const live = espn.filter((g) => view(g).state === 'in');
    const games = await Promise.all(live.map(async (g) => {
        const hw = await kv.get(`gamestate:${g.id}`, 'json').catch(() => null) as GameState | null;
        const inKv = kvById.get(g.id);
        return {
            id: g.id,
            name: g.shortName,
            espn: view(g),
            kvScoreboard: inKv ? view(inKv) : null,
            highWater: hw,
        };
    }));

    return new Response(JSON.stringify({
        at: now,
        config: {
            scoreboardRefresh: CURRENT_SEASON_CONFIG.scoreboardRefreshRate,
            liveGameRefresh: CURRENT_SEASON_CONFIG.liveGameRefreshRate,
            ttlMultiplier: CACHE_TTL_MULTIPLIER,
        },
        kvScoreboard: { age: kvScoreboardAge, games: kvGames.length, present: !!cached?.value },
        liveCount: live.length,
        games,
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
