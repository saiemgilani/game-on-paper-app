// src/routes/basketball/nbaCup.ts
/**
 * Page-side step of /nba/cup (BB-G30, behind 'bball-nba-cup' inside 'nba'): which snapshot day the page shows
 * (utils/bracketology.ts pickSnapshot, the standings pages' rule), then that day's Cup standings and sims. A failed
 * read (the routes answer 500 until sdv-db #188 deploys) is the page's empty state, never a crash. The template is
 * components/routes/NbaCupRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { retrieveCupSnapshot, retrieveLatestCupSnapshot, type CupSnapshot } from '../../resources/nbaCup';
import { pickSnapshot, type SnapshotPick } from '../../utils/bracketology';
import { CUP_FIRST_SEASON } from '../../utils/nbaCup';
import { proSeasonOf } from '../../utils/playoffPicture';
import { seasonCache, setCache, uncacheable } from './cache';

export const CUP_VIEWS = [
    { key: 'groups', label: 'Groups' },
    { key: 'wildcard', label: 'Wild card' },
    { key: 'bracket', label: 'Knockout' },
    { key: 'odds', label: 'Odds' },
] as const;
export type CupView = (typeof CUP_VIEWS)[number]['key'];

export interface NbaCupParams {
    seasons: number[];
    current: number;
    pick: SnapshotPick;
    /** null when the pick found no snapshot or a read failed */
    data: CupSnapshot | null;
    /** true when a read failed: the page says the numbers are unavailable rather than that there are none */
    failed: boolean;
    view: CupView;
}

export async function prepareNbaCup(Astro: AstroGlobal, today = new Date()): Promise<NbaCupParams> {
    Astro.locals.league = 'nba';
    const sp = Astro.url.searchParams;
    const current = Math.max(proSeasonOf('nba', today), CUP_FIRST_SEASON);
    const seasons = Array.from({ length: current - CUP_FIRST_SEASON + 1 }, (_, i) => CUP_FIRST_SEASON + i);
    const asked = Number(sp.get('season'));
    const requested = seasons.includes(asked) ? asked : null;
    const view = CUP_VIEWS.find((v) => v.key === sp.get('view'))?.key ?? 'groups';
    let pick: SnapshotPick = { snapshot: null, season: requested ?? current, fallback: false };
    let data: CupSnapshot | null = null;
    let failed = false;
    try {
        pick = await pickSnapshot(requested, current, retrieveLatestCupSnapshot);
        if (pick.snapshot) data = await retrieveCupSnapshot(pick.snapshot);
    } catch (e: any) {
        console.error(`ERROR while loading the NBA Cup snapshot: ${e}, ${e?.stack}`);
        failed = true;
        pick = { snapshot: null, season: pick.season, fallback: false };
        data = null;
    }
    // no snapshot (yet) or a failed read: never hold the empty page for the season window
    if (data && data.sims.length > 0) setCache(Astro, seasonCache('nba'));
    else uncacheable(Astro);
    return { seasons, current, pick, data, failed, view };
}
