// src/routes/basketball/bestGames.ts
/**
 * Page-side step of /<league>/best-games (BB-G29, behind 'bball-gei' inside the league's flag): the season (the current
 * one, or last season's when the current one has no completed game yet), its games joined and ordered by GEI, then the
 * day-range and team filters. The template is components/routes/BestGamesRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { retrieveBestGamesSeason } from '../../resources/bestGames';
import { filterBestGames, isDay, joinBestGames, teamOptions, type BestGame, type BestGamesFilter } from '../../utils/bestGames';
import { LEAGUES, type BasketballLeague } from '../../utils/league';
import { seasonCache, setCache, uncacheable } from './cache';

/**
 * The first season the select offers (END years): sdv-db's game-page backfill floor for game_excitement
 * (`SDV_DB_INGEST_SEASONS=2002:2027`, sdv-db #185 deploy step 6), or the league's first season when later. A season the
 * table does not hold renders the empty state.
 */
export const GEI_FIRST_SEASON = 2002;

export interface BestGamesParams {
    league: BasketballLeague;
    seasons: number[];
    current: number;
    season: number;
    /** the current season had no ranked game, so this is last season's board */
    fallback: boolean;
    filter: BestGamesFilter;
    teams: { id: string; name: string }[];
    games: BestGame[];
    /** the season's ranked games before the filters */
    total: number;
    /** the season's first and last ranked game days (the date inputs' bounds); null when it has none */
    days: { first: string; last: string } | null;
}

export type BestGamesPrep = { unavailable: true } | BestGamesParams;

export async function prepareBestGames(Astro: AstroGlobal, league: BasketballLeague): Promise<BestGamesPrep> {
    Astro.locals.league = league;
    const sp = Astro.url.searchParams;
    const current = LEAGUES[league].seasons.at(-1)!;
    const first = Math.max(GEI_FIRST_SEASON, LEAGUES[league].seasons[0]);
    const seasons = Array.from({ length: current - first + 1 }, (_, i) => first + i);
    const asked = Number(sp.get('season'));
    let season = seasons.includes(asked) ? asked : current;
    let fallback = false;
    let all: BestGame[];
    try {
        const load = async (s: number) => { const r = await retrieveBestGamesSeason(league, s); return joinBestGames(r.excitement, r.schedule); };
        all = await load(season);
        // an explicit ?season= never falls back; the default does, once, labelled (the bracketology pages' rule)
        if (all.length === 0 && !seasons.includes(asked) && seasons.includes(current - 1)) {
            season = current - 1;
            fallback = true;
            all = await load(season);
        }
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} best games: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    const teams = teamOptions(all);
    const from = sp.get('from');
    const to = sp.get('to');
    const t = sp.get('team');
    const filter: BestGamesFilter = {
        from: isDay(from) ? from : null,
        to: isDay(to) ? to : null,
        team: t && teams.some((x) => x.id === t) ? t : null,
    };
    // an empty board is never held for the season window
    if (all.length > 0) setCache(Astro, seasonCache(league));
    else uncacheable(Astro);
    const dates = all.map((g) => g.date).sort();
    const days = dates.length ? { first: dates[0], last: dates.at(-1)! } : null;
    return { league, seasons, current, season, fallback, filter, teams, games: filterBestGames(all, filter), total: all.length, days };
}
