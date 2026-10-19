/**
 * Page-side step of /<league>/scatter: blazing-the-nets' readScatter over the Data API. One read, the
 * season's player rows; blazing's scatterPoints (copied) builds the points at the league-season's FGA bar with the
 * featured team flagged and each player's headshot for the Faces mode. Axes, marks, the filter and the
 * zoom are client state in ScatterExplorer.svelte.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL, rankMins } from '../../basketball/config';
import { defaultScatterConference, filterByConference, isNcaaDashboards, scatterConferenceOptions, type ConferenceOption } from '../../basketball/dashboards';
import { headshotsFromRows, playerSeasonsFromRows } from '../../nba/adapters';
import type { RankMins } from '../../nba/data/ranks';
import { scatterPoints } from '../../nba/data/scatter';
import type { ScatterPoint } from '../../nba/scatterMetrics';
import { retrieveConferenceRows } from '../../resources/nbaShots';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { uncacheable } from './cache';
import { readBasketballSeasonRows, readCoverageNote, resolveBasketballSeason } from './season';

export interface BasketballScatterParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    points: ScatterPoint[];
    /** the league-season's bars (rankMins): the NBA's 100 FGA / 50 3PA, scaled by season length */
    min: RankMins;
    /** a college season's shot_coverage sentence (D24); absent for the NBA/WNBA */
    coverage?: string | null;
    /** college: the conference filter (D42) */
    conference?: { options: ConferenceOption[]; selected: string };
}

export type BasketballScatterPrep = { unavailable: true } | BasketballScatterParams;

export async function prepareBasketballScatter(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballScatterPrep> {
    Astro.locals.league = league;
    const cfg = BASKETBALL[league];
    const ft = cfg.featuredTeam;
    const resolved = resolveBasketballSeason(Astro, league);
    const coverageP = readCoverageNote(league, resolved.season);
    const confP = isNcaaDashboards(league) ? retrieveConferenceRows(resolved.season, league) : undefined;
    confP?.catch(() => {});
    const rows = await readBasketballSeasonRows(Astro, league, resolved.season, leaguePath(league, '/scatter'));
    if (rows === null) return { unavailable: true };
    const min = rankMins(league, resolved.season);
    // D42/D46 (R2): the college scatter shows one conference (computed default) or All D-I; only the chosen rows become points
    let conference: { options: ConferenceOption[]; selected: string } | undefined;
    let shown = rows;
    if (confP) {
        try {
            const c = await confP;
            const options = scatterConferenceOptions(c.teams, c.groups);
            const asked = Astro.url.searchParams.get('conference');
            const selected = asked === 'all' || options.some((o) => o.slug === asked) ? asked! : defaultScatterConference(rows, c.teams, resolved.season, league);
            conference = { options, selected };
            shown = filterByConference(rows, c.teams, selected);
        } catch (e: any) {
            console.error(`ERROR while loading the ${league} conferences for the ${resolved.season} scatter: ${e}, ${e?.stack}`);
            uncacheable(Astro); // decorative: All D-I, no selector
        }
    }
    const points = scatterPoints(playerSeasonsFromRows(shown), headshotsFromRows(shown), ft?.statsTeamId ?? null, { colorOf: (id) => cfg.teams.inSeason(id, resolved.season)?.color, min });
    const coverage = await coverageP;
    if (coverage === undefined) uncacheable(Astro);
    return { ...resolved, points, min, ...(isNcaaDashboards(league) ? { coverage: coverage ?? null } : {}), ...(conference ? { conference } : {}) };
}
