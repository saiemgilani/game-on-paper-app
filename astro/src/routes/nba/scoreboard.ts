// /nba/scoreboard: ESPN's current day by default, any day with ?date=YYYY-MM-DD.
// "Today" is ESPN's own day.date (its day rolls over mid-morning US Eastern), so a dated
// request that names that day is the live page: same fetch, same key, same TTL. That only
// holds while the live read is fresh: a degraded or last-good (stale) read says nothing
// reliable about ESPN's day, so a dated request is then a plain dated fetch, uncached.
import type { AstroGlobal } from 'astro';
import { getScoreboardForDay, type ESPNScheduleEvent } from '../../resources/espn';
import { dayNav, parseDateParam, sortScoreboard, toEspnDate } from '../../nba/scoreboard';
import { setCache, uncacheable } from './cache';
import { gopStorage } from '../../utils/telemetry';
import { CACHE_TTL_MULTIPLIER, CURRENT_SEASON_CONFIG } from '../../utils/config';

export type NbaScoreboardParams = {
    day: string; isLive: boolean; degraded: boolean; games: ESPNScheduleEvent[];
    nav: { prev: string; next: string; label: string }; today: string;
    /** The live board was last-good or degraded: `day` is what was served, never "tonight". */
    stale: boolean;
};
export type NbaScoreboardPrep = { badDate: 'format' | 'calendar' | 'range' } | NbaScoreboardParams;

export const LIVE_SCOREBOARD_CACHE = {
    maxAge: CURRENT_SEASON_CONFIG.scoreboardRefreshRate,
    swr: CURRENT_SEASON_CONFIG.scoreboardRefreshRate * CACHE_TTL_MULTIPLIER,
    tags: ['scoreboard', 'league:nba', 'nba'],
};
export const PAST_DAY_CACHE = { maxAge: 60 * 60 * 24, tags: ['nba'] };
export const FUTURE_DAY_CACHE = { maxAge: 60 * 60, tags: ['nba'] };

export async function prepareNbaScoreboard(Astro: AstroGlobal): Promise<NbaScoreboardPrep> {
    Astro.locals.league = 'nba';
    const raw = Astro.url.searchParams.get('date') || null;
    // Validate before any upstream call. The ceiling uses the server's UTC date (never behind
    // ESPN's day, so at most one day looser than the contract).
    const check = parseDateParam(raw, new Date().toISOString().slice(0, 10));
    if (!check.ok) { uncacheable(Astro); return { badDate: check.reason }; }

    const live = await getScoreboardForDay('nba', null);
    const fresh = !live.degraded && !live.stale;
    const date = raw ?? live.day;
    const useLive = raw === null || (fresh && raw === live.day);
    const isLive = useLive && fresh;
    const board = useLive ? live : await getScoreboardForDay('nba', toEspnDate(date), fresh && date < live.day ? { pastDay: true } : {});
    const games = sortScoreboard(board.events);

    if (board.degraded || board.stale || (!useLive && !fresh)) {
        // Not ESPN-confirmed: no cache (a fresh retry beats an hour of a guess) and no telemetry.
        uncacheable(Astro);
    } else if (isLive) {
        setCache(Astro, LIVE_SCOREBOARD_CACHE);
        feedGameMeta(games);
    } else {
        // ESPN's day after the one the live key holds is its real current day during the KV lag at rollover
        setCache(Astro, date < live.day ? PAST_DAY_CACHE : date === dayNav(live.day).next ? LIVE_SCOREBOARD_CACHE : FUTURE_DAY_CACHE);
    }
    return { day: date, isLive, degraded: board.degraded, games, nav: dayNav(date), today: live.day, stale: !fresh };
}

/** One upserted gop.game_meta row per live event, as routes/scoreboard.ts does for football. */
function feedGameMeta(games: ESPNScheduleEvent[]): void {
    const gop = gopStorage.getStore();
    if (!gop) return;
    for (const ev of games) {
        const comp = ev.competitions?.[0];
        if (!ev.id || !comp) continue;
        const side = (ha: string) => comp.competitors?.find((c: any) => c.homeAway === ha);
        const home = side('home'), away = side('away');
        gop.events.push({ table: 'game_meta', row: {
            game_id: Number(ev.id), season: (ev as any).season?.year ?? null, week: null,
            away_abbr: away?.team?.abbreviation ?? null, home_abbr: home?.team?.abbreviation ?? null,
            away_score: away?.score != null ? Number(away.score) : null, home_score: home?.score != null ? Number(home.score) : null,
            status: comp.status?.type?.name ?? null, kickoff_ts: comp.date ?? null, last_seen: new Date().toISOString(),
        } });
    }
}
