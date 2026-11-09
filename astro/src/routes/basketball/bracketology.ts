// src/routes/basketball/bracketology.ts
/**
 * Page-side step of /<mbb|wbb>/bracketology (BB-G22, behind 'bball-bracketology' inside the league's flag): which
 * snapshot day the page shows (utils/bracketology.ts pickSnapshot), then that day's three tables. The template is
 * components/routes/BracketologyRoute.astro.
 */
import type { AstroGlobal } from 'astro';
import { retrieveLatestSnapshot, retrieveSnapshot, type CollegeSnapshot } from '../../resources/bracketology';
import { collegeSeasonOf, pickSnapshot, type SnapshotPick } from '../../utils/bracketology';
import { LEAGUES, type BasketballLeague } from '../../utils/league';
import { seasonCache, setCache, uncacheable } from './cache';
import { retrieveSeasonRatings } from '../../resources/pregameProjection';
import { isFeatureEnabled } from '../../utils/features';
import type { TeamRating } from '../../utils/pregameProjection';

export const VIEWS = [
    { key: 'bracket', label: 'Bracket' },
    { key: 'standings', label: 'Standings' },
    { key: 'resume', label: 'Team sheets' },
] as const;
export type BracketologyView = (typeof VIEWS)[number]['key'];

export interface BracketologyParams {
    league: BasketballLeague;
    seasons: number[];
    current: number;
    pick: SnapshotPick;
    /** null when the pick found no snapshot */
    data: CollegeSnapshot | null;
    view: BracketologyView;
    /** a conference_id from the snapshot, or null for every conference */
    conference: string | null;
    /** BB-G18: the season's ratings for the bracket's game odds, only with 'bball-pregame-projection' on and the bracket view; null when the read failed */
    ratings?: Map<string, TeamRating> | null;
}

export type BracketologyPrep = { unavailable: true } | BracketologyParams;

export async function prepareBracketology(Astro: AstroGlobal, league: BasketballLeague, today = new Date()): Promise<BracketologyPrep> {
    Astro.locals.league = league;
    const sp = Astro.url.searchParams;
    const current = Math.max(collegeSeasonOf(today), LEAGUES[league].seasons.at(-1)!);
    const first = LEAGUES[league].seasons[0];
    const seasons = Array.from({ length: current - first + 1 }, (_, i) => first + i);
    const asked = Number(sp.get('season'));
    const requested = seasons.includes(asked) ? asked : null;
    const view = VIEWS.find((v) => v.key === sp.get('view'))?.key ?? 'bracket';
    let pick: SnapshotPick;
    let data: CollegeSnapshot | null = null;
    try {
        pick = await pickSnapshot(requested, current, (s) => retrieveLatestSnapshot(league, s));
        if (pick.snapshot) data = await retrieveSnapshot(league, pick.snapshot);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} bracketology snapshot: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    // no snapshot (yet): never hold the empty page for the season window
    if (data && data.sims.length > 0) setCache(Astro, seasonCache(league));
    else uncacheable(Astro);
    const conf = sp.get('conference');
    const conference = conf && data?.sims.some((r) => String(r.conference_id) === conf) ? conf : null;
    // BB-G18: the bracket's numbers become game odds from the season's ratings; off (or another view) reads nothing
    if (!data || view !== 'bracket' || !isFeatureEnabled('bball-pregame-projection', Astro.locals)) return { league, seasons, current, pick, data, view, conference };
    let ratings: Map<string, TeamRating> | null = null;
    try {
        ratings = await retrieveSeasonRatings(league, pick.season);
    } catch (e: any) {
        // the bracket keeps its chances to make the field; a failed read is never held
        console.error(`ERROR while loading the ${league} ${pick.season} ratings for the bracket: ${e}, ${e?.stack}`);
        uncacheable(Astro);
    }
    return { league, seasons, current, pick, data, view, conference, ratings };
}
