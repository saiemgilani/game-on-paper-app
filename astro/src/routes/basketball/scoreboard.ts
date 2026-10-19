// /<league>/scoreboard: ESPN's current day by default, any day with ?date=YYYY-MM-DD.
// "Today" is ESPN's own day.date (its day rolls over mid-morning US Eastern), so a dated
// request that names that day is the live page: same fetch, same key, same TTL. That only
// holds while the live read is fresh: a degraded or last-good (stale) read says nothing
// reliable about ESPN's day, so a dated request is then a plain dated fetch, uncached.
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { getScoreboardForDay, type ESPNScheduleEvent } from '../../resources/espn';
import { dayNav, parseDateParam, sortScoreboard, toEspnDate } from '../../nba/scoreboard';
import { setCache, uncacheable } from './cache';
import { gopStorage } from '../../utils/telemetry';
import { CACHE_TTL_MULTIPLIER } from '../../utils/config';
import type { BasketballLeague } from '../../utils/league';
import { wnbaEraTricode } from '../../nba/data/wnbaTeams';

export type BasketballScoreboardParams = {
    day: string; isLive: boolean; degraded: boolean; games: ESPNScheduleEvent[];
    nav: { prev: string; next: string; label: string }; today: string;
    /** The live board was last-good or degraded: `day` is what was served, never "tonight". */
    stale: boolean;
    /** No ?date= was given. With `degraded` the day is the server's guess, so the page names no date. */
    undated?: boolean;
};
export type BasketballScoreboardPrep = { badDate: 'format' | 'calendar' | 'range' } | BasketballScoreboardParams;

export function scoreboardCaches(league: BasketballLeague) {
    const refresh = BASKETBALL[league].scoreboardRefresh;
    return {
        live: { maxAge: refresh, swr: refresh * CACHE_TTL_MULTIPLIER, tags: ['scoreboard', `league:${league}`, league] },
        pastDay: { maxAge: 60 * 60 * 24, tags: [league] },
        // A final does not change: days more than a week behind ESPN's day are held two weeks.
        oldDay: { maxAge: 60 * 60 * 24 * 14, tags: [league] },
        futureDay: { maxAge: 60 * 60, tags: [league] },
    };
}
export const OLD_DAY_AFTER_DAYS = 7;

export async function prepareBasketballScoreboard(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballScoreboardPrep> {
    Astro.locals.league = league;
    const cfg = BASKETBALL[league];
    const c = scoreboardCaches(league);
    const raw = Astro.url.searchParams.get('date') || null;
    // Validate before any upstream call. The ceiling uses the server's UTC date (never behind
    // ESPN's day, so at most one day looser than the contract).
    const check = parseDateParam(raw, new Date().toISOString().slice(0, 10), cfg.firstScoreboardDay);
    if (!check.ok) { uncacheable(Astro); return { badDate: check.reason }; }

    const live = await getScoreboardForDay(league, null);
    const fresh = !live.degraded && !live.stale;
    const date = raw ?? live.day;
    const useLive = raw === null || (fresh && raw === live.day);
    const isLive = useLive && fresh;
    const board = useLive ? live : await getScoreboardForDay(league, toEspnDate(date), fresh && date < live.day ? (isOld(date, live.day) ? { pastDay: true, oldDay: true } : { pastDay: true }) : {});
    // A WNBA franchise's tricode of that season where it differs from ESPN's (ESPN spells 2005's Detroit Shock "TUL").
    // Keyed by id and season, so a repeat pass over a cached board is a no-op.
    if (league === 'wnba') for (const ev of board.events) for (const c of ev.competitions?.[0]?.competitors ?? []) {
        const tri = wnbaEraTricode(Number(c.id), (ev as any).season?.year);
        if (tri && c.team) c.team.abbreviation = tri;
    }
    const games = sortScoreboard(board.events);

    if (board.degraded || board.stale || (!useLive && !fresh)) {
        // Not ESPN-confirmed: no cache (a fresh retry beats an hour of a guess) and no telemetry.
        uncacheable(Astro);
    } else if (isLive) {
        setCache(Astro, c.live);
        feedGameMeta(games);
    } else {
        // ESPN's day after the one the live key holds is its real current day during the KV lag at rollover
        setCache(Astro, date < live.day ? (isOld(date, live.day) ? c.oldDay : c.pastDay) : date === dayNav(live.day).next ? c.live : c.futureDay);
    }
    return { day: date, isLive, degraded: board.degraded, games, nav: dayNav(date), today: live.day, undated: raw === null, stale: useLive ? !fresh : !!board.stale };
}

const isOld = (date: string, liveDay: string) => (Date.parse(liveDay) - Date.parse(date)) / 86400000 > OLD_DAY_AFTER_DAYS;

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
