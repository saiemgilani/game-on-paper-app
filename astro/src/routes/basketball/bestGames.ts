// src/routes/basketball/bestGames.ts
/**
 * Page-side step of /<league>/best-games (BB-G29, behind 'bball-gei' inside the league's flag): the season (the current
 * one, or last season's when the current one has no completed game yet), its games joined and ordered by GEI, then the
 * day-range and team filters. The template is components/routes/BestGamesRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { retrieveBestGamesSeason } from '../../resources/bestGames';
import { BOARD_SIZE, filterBestGames, isDay, joinBestGames, teamOptions, type BestGame, type BestGamesFilter } from '../../utils/bestGames';
import { LEAGUES, PRO_LEAGUES, type BasketballLeague } from '../../utils/league';
import { collegeSeasonOf } from '../../utils/bracketology';
import { proSeasonOf, type ProLeague } from '../../utils/playoffPicture';
import { seasonCache, setCache, uncacheable } from './cache';

/**
 * The first season the select offers (END years): the first season sdv-db's game_excitement holds per league, read off the
 * live table 2026-11-04 (season-filtered probes: nba and wnba from 2002, the game-page backfill floor; mbb from 2003, 18
 * games; wbb from 2004). A season the table does not hold renders the empty state.
 */
export const GEI_FIRST_SEASON: Record<BasketballLeague, number> = { nba: 2002, wnba: 2002, mbb: 2003, wbb: 2004 };

export interface BestGamesParams {
    league: BasketballLeague;
    seasons: number[];
    current: number;
    season: number;
    /** the current season had no ranked game, so this is last season's board */
    fallback: boolean;
    filter: BestGamesFilter;
    teams: { id: string; name: string }[];
    /** the board: the first BOARD_SIZE of the games that pass the filters */
    games: BestGame[];
    /** the games that pass the filters */
    matched: number;
    /** the season's ranked games before the filters */
    total: number;
    /** the season's first and last ranked game days (the date inputs' bounds); null when it has none */
    days: { first: string; last: string } | null;
}

export type BestGamesPrep = { unavailable: true } | BestGamesParams;

/** The season being played (END year), or the league's last known one when that is later: the standings pages' rule. */
const seasonOf = (league: BasketballLeague, day: Date) =>
    Math.max(PRO_LEAGUES.includes(league) ? proSeasonOf(league as ProLeague, day) : collegeSeasonOf(day), LEAGUES[league].seasons.at(-1)!);

export async function prepareBestGames(Astro: AstroGlobal, league: BasketballLeague, today = new Date()): Promise<BestGamesPrep> {
    Astro.locals.league = league;
    const sp = Astro.url.searchParams;
    const current = seasonOf(league, today);
    const first = GEI_FIRST_SEASON[league];
    const seasons = Array.from({ length: current - first + 1 }, (_, i) => first + i);
    const asked = Number(sp.get('season'));
    let season = seasons.includes(asked) ? asked : current;
    let fallback = false;
    let all: BestGame[];
    try {
        const load = async (s: number) => { const r = await retrieveBestGamesSeason(league, s); return joinBestGames(r.excitement, r.schedule); };
        all = await load(season);
        // the current season (the default URL, or its own ?season=) falls back once, labelled; an explicit past season never
        // does (the bracketology pages' rule)
        if (all.length === 0 && season === current && seasons.includes(current - 1)) {
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
    const matches = filterBestGames(all, filter);
    return { league, seasons, current, season, fallback, filter, teams, games: matches.slice(0, BOARD_SIZE), matched: matches.length, total: all.length, days };
}
