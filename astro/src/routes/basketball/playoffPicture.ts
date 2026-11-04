// src/routes/basketball/playoffPicture.ts
/**
 * Page-side step of /<nba|wnba>/standings (BB-G23, behind 'bball-playoff-picture' inside the league's flag): which
 * snapshot day the page shows (utils/bracketology.ts pickSnapshot, the college page's rule), then that day's sims and
 * standings and the season's lottery odds. The template is components/routes/PlayoffPictureRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { retrieveLatestProSnapshot, retrieveProSnapshot, type ProSnapshot } from '../../resources/playoffPicture';
import { pickSnapshot, type SnapshotPick } from '../../utils/bracketology';
import { PRO_SNAPSHOT_FIRST_SEASON, proSeasonOf, type ProLeague } from '../../utils/playoffPicture';
import { seasonCache, setCache, uncacheable } from './cache';

export const PRO_VIEWS = [
    { key: 'standings', label: 'Standings', leagues: ['nba', 'wnba'] },
    { key: 'seeds', label: 'Seed odds', leagues: ['nba', 'wnba'] },
    { key: 'divisions', label: 'Divisions', leagues: ['nba'] },
    { key: 'bracket', label: 'Bracket', leagues: ['nba', 'wnba'] },
    { key: 'lottery', label: 'Lottery', leagues: ['nba', 'wnba'] },
] as const;
export type ProView = (typeof PRO_VIEWS)[number]['key'];

export const viewsFor = (league: ProLeague) => PRO_VIEWS.filter((v) => (v.leagues as readonly string[]).includes(league));

export interface PlayoffPictureParams {
    league: ProLeague;
    seasons: number[];
    current: number;
    pick: SnapshotPick;
    /** null when the pick found no snapshot */
    data: ProSnapshot | null;
    view: ProView;
}

export type PlayoffPicturePrep = { unavailable: true } | PlayoffPictureParams;

export async function preparePlayoffPicture(Astro: AstroGlobal, league: ProLeague, today = new Date()): Promise<PlayoffPicturePrep> {
    Astro.locals.league = league;
    const sp = Astro.url.searchParams;
    const current = Math.max(proSeasonOf(league, today), PRO_SNAPSHOT_FIRST_SEASON);
    const seasons = Array.from({ length: current - PRO_SNAPSHOT_FIRST_SEASON + 1 }, (_, i) => PRO_SNAPSHOT_FIRST_SEASON + i);
    const asked = Number(sp.get('season'));
    const requested = seasons.includes(asked) ? asked : null;
    const view = viewsFor(league).find((v) => v.key === sp.get('view'))?.key ?? 'standings';
    let pick: SnapshotPick;
    let data: ProSnapshot | null = null;
    try {
        pick = await pickSnapshot(requested, current, (s) => retrieveLatestProSnapshot(league, s));
        if (pick.snapshot) data = await retrieveProSnapshot(league, pick.snapshot);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} playoff picture snapshot: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    // no snapshot (yet): never hold the empty page for the season window
    if (data && data.sims.length > 0) setCache(Astro, seasonCache(league));
    else uncacheable(Astro);
    return { league, seasons, current, pick, data, view };
}
