// src/routes/basketball/leaders.ts
/**
 * Page-side step of /<league>/leaders: blazing-the-nets' readLeaders over the Data API. Two reads,
 * the season's player rows (names) and every player's game rows (a college league: the last 49 days', D26); blazing's leaderBoards
 * (copied) builds every window x metric board in the Worker. The page is a season page, so
 * Workers Caching holds the result for 6 h (+ 6 h stale): blazing memoised it per process for
 * the same window. No game rows (a season without logs) is boards: null, which the page explains.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { isNcaaDashboards } from '../../basketball/dashboards';
import { seasonLinesFromRows, seasonPlayerGamesFromRows } from '../../nba/adapters';
import { leaderBoards, type Boards, type LeaderWindow } from '../../nba/data/leaders';
import { fmtDate } from '../../nba/format';
import { retrieveLatestGameDate, retrieveSeasonPlayerGameRows, type PlayerGameRow } from '../../resources/nbaShots';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { seasonCache, setCache, uncacheable } from './cache';
import { readBasketballSeasonRows, readCoverageNote, resolveBasketballSeason } from './season';

export interface BasketballLeadersParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    /** null when the season has no placeable game logs: rolling windows need game dates. */
    boards: Boards | null;
    /** a college season's shot_coverage sentence (D24); absent for the NBA/WNBA */
    coverage?: string | null;
    /** college (D26): the windows built and the note naming the read's first day */
    windows?: readonly LeaderWindow[];
    windowNote?: string;
}

export type BasketballLeadersPrep = { unavailable: true } | BasketballLeadersParams;

/**
 * The leaders' game rows: the whole season (NBA, WNBA), or for a league with leadersRead the rows of the last `days` dates
 * up to the season's latest game, inclusive (R-P4: from latest - (days - 1); D26: a college season is over the API's
 * 50,000-row cap; plans/2026-10-11-mbb-shots-gop.md measured every 49-day window of 2019-2026 at 43,835 rows or fewer).
 */
async function readLeaderGames(season: number, league: BasketballLeague): Promise<{ rows: PlayerGameRow[]; since: string | null }> {
    const lr = BASKETBALL[league].leadersRead;
    if (!lr) return { rows: await retrieveSeasonPlayerGameRows(season, league), since: null };
    const latest = await retrieveLatestGameDate(season, league);
    if (!latest) return { rows: [], since: null };
    const since = new Date(Date.parse(`${latest}T00:00:00Z`) - (lr.days - 1) * 864e5).toISOString().slice(0, 10);
    return { rows: await retrieveSeasonPlayerGameRows(season, league, since), since };
}

export async function prepareBasketballLeaders(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballLeadersPrep> {
    Astro.locals.league = league;
    const ft = BASKETBALL[league].featuredTeam;
    const route = leaguePath(league, '/leaders');
    const resolved = resolveBasketballSeason(Astro, league);
    const { season } = resolved;
    // the season-players read settles the cache policy; it is set below once the game rows are in too
    const coverageP = readCoverageNote(league, season);
    const [players, games] = await Promise.all([
        readBasketballSeasonRows(Astro, league, season, route, false),
        readLeaderGames(season, league).catch((e: any) => {
            console.error(`ERROR while loading season game rows for ${route} ${season}: ${e}, ${e?.stack}`);
            uncacheable(Astro);
            return null;
        }),
    ]);
    if (!players || !games) return { unavailable: true };
    const coverage = await coverageP;
    const placed = seasonPlayerGamesFromRows(games.rows, players);
    if (players.length > 0) setCache(Astro, seasonCache(league)); // empty: readBasketballSeasonRows already made it uncacheable
    // D31: the league-season's per-game bars (the NBA's NBA_LEADER_BARS, so its boards are unchanged)
    if (coverage === undefined) uncacheable(Astro);
    // D26: a restricted read builds only its windows and ranks "Most improved" against the season rows' line (the NBA/WNBA: {}, identical boards)
    const lr = BASKETBALL[league].leadersRead;
    const opts = lr ? { windows: lr.windows, seasonLines: seasonLinesFromRows(players) } : {};
    return {
        ...resolved,
        boards: placed.length ? leaderBoards(placed, ft?.statsTeamId ?? null, 15, BASKETBALL[league].leaderBars(season), opts) : null,
        ...(isNcaaDashboards(league) ? { coverage: coverage ?? null } : {}),
        ...(lr && games.since ? { windows: lr.windows, windowNote: ` Windows count games from ${fmtDate(games.since)} on: the last ${lr.days} days of games.` } : {}),
    };
}
