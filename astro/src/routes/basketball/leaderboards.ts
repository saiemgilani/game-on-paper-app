// src/routes/basketball/leaderboards.ts
/**
 * Page-side step of /<league>/leaderboards (BB-G8, behind 'bball-leaderboards-v2' inside the league's flag): the URL's
 * controls (utils/leaderboards.ts parseControls), the board's one read, then the qualified filter and the order. A failed
 * read is the page's "unavailable" line and is never cached; an empty season is not cached either. The template is
 * components/routes/BasketballLeaderboardsRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { BOARD_CAP, retrieveBoard, type BoardRow } from '../../resources/leaderboards';
import { boardSpec, hasPercentiles, isQualified, parseControls, sortRows, type BoardSpec, type Controls } from '../../utils/leaderboards';
import type { BasketballLeague } from '../../utils/league';
import { seasonCache, setCache, uncacheable } from './cache';
import { resolveBasketballSeason } from './season';

export interface LeaderboardsParams {
    league: BasketballLeague;
    season: number;
    seasons: number[];
    current: number;
    controls: Controls;
    spec: BoardSpec;
    /** the rows shown, in order; null when the read failed */
    rows: BoardRow[] | null;
    /** rows read, before the qualified filter */
    read: number;
    /** the read hit BOARD_CAP: the caption says the board is the most-used rows */
    capped: boolean;
    pctAvailable: boolean;
    names: Map<string, string>;
}

export async function prepareLeaderboards(Astro: AstroGlobal, league: BasketballLeague): Promise<LeaderboardsParams> {
    Astro.locals.league = league;
    const { season, seasons, current } = resolveBasketballSeason(Astro, league);
    const sp = Astro.url.searchParams;
    // the board, group and unit settle the read; the view needs the rows, so it is resolved again after
    const asked = parseControls(sp, league, () => true);
    let rows: BoardRow[] | null = null;
    let names = new Map<string, string>();
    try {
        ({ rows, names } = await retrieveBoard(league, season, asked.board, asked.group, asked.unit));
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${asked.board} board for ${season}: ${e}, ${e?.stack}`);
    }
    const all = rows ?? [];
    const controls = parseControls(sp, league, (spec, basis) => hasPercentiles(all, spec, basis));
    const spec = boardSpec(controls.board, league, controls.group);
    const sortCol = spec.cols.find((c) => c.key === controls.sort)!;
    const kept = controls.qualified ? all.filter((r) => isQualified(r, spec, league)) : all;
    if (rows && rows.length > 0) setCache(Astro, seasonCache(league));
    else uncacheable(Astro);
    return {
        league, season, seasons, current, controls, spec,
        rows: rows ? sortRows(kept, sortCol, controls.basis, controls.view) : null,
        read: all.length,
        capped: controls.board !== 'teams' && all.length >= BOARD_CAP,
        pctAvailable: hasPercentiles(all, spec, controls.basis),
        names,
    };
}
