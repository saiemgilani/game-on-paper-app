/**
 * The scoreboard page's data step, shared by `pages/index.astro` (cfb) and
 * `pages/nfl/index.astro`. Fetches the live scoreboard, feeds the matchup
 * dimension of the telemetry store, and sets the cache policy on the page.
 */
import type { AstroGlobal } from 'astro';
import { getCurrentScoreboard, type ESPNScheduleEvent } from '../resources/espn';
import { gopStorage } from '../utils/telemetry';
import { CACHE_TTL_MULTIPLIER, CURRENT_SEASON_CONFIG } from '../utils/config';
import type { League } from '../utils/league';

export async function loadScoreboard(Astro: AstroGlobal, league: League): Promise<ESPNScheduleEvent[]> {
    Astro.locals.league = league;
    let games: ESPNScheduleEvent[] = [];
    try {
        games = await getCurrentScoreboard(true, true, league);
        // Feed the matchup dimension: one upserted gop.game_meta row per event, so
        // admin views can name a game instead of showing a bare id. The ingest path
        // batches these; the write is an ON CONFLICT upsert.
        const gop = gopStorage.getStore();
        if (gop) {
            for (const ev of games) {
                const comp = ev.competitions?.[0];
                const side = (ha: string) => comp?.competitors?.find((c: any) => c.homeAway === ha);
                const home = side("home"), away = side("away");
                if (!ev.id || !comp) continue;
                gop.events.push({ table: "game_meta", row: {
                    game_id: Number(ev.id),
                    season: (ev as any).season?.year ?? null,
                    week: (ev as any).week?.number ?? null,
                    away_abbr: away?.team?.abbreviation ?? null,
                    home_abbr: home?.team?.abbreviation ?? null,
                    away_score: away?.score != null ? Number(away.score) : null,
                    home_score: home?.score != null ? Number(home.score) : null,
                    status: comp.status?.type?.name ?? null,
                    kickoff_ts: comp.date ?? null,
                    last_seen: new Date().toISOString(),
                } });
            }
        }
        Astro.cache.set({
            maxAge: CURRENT_SEASON_CONFIG.scoreboardRefreshRate,
            swr: CURRENT_SEASON_CONFIG.scoreboardRefreshRate * CACHE_TTL_MULTIPLIER,
            tags: ["favorites-enabled", "scoreboard", `league:${league}`],
        });
    } catch (e) {
        console.error(`ERROR while fetching games for ${JSON.stringify(Astro.props)}: ${e}`)
        Astro.cache.set(false);
        Astro.response.headers.set("Cache-Control", "no-store"); // set(false) alone is cached ~2h by Workers Caching
        // make sure the page still loads
        games = [];
    }
    return games;
}
