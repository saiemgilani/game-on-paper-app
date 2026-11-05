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
import { scatterPoints, teamPoints, withImpact } from '../../nba/data/scatter';
import type { ScatterPoint } from '../../nba/scatterMetrics';
import { retrieveConferenceRows } from '../../resources/nbaShots';
import { retrieveSeasonImpact, retrieveSeasonTeamStrength } from '../../resources/scatterViews';
import { isFeatureEnabled } from '../../utils/features';
import { leaguePath, PRO_LEAGUES, teamLogoUrl, type BasketballLeague } from '../../utils/league';
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
    /**
     * BB-G10, only with 'bball-impact-scatter' on (NBA/WNBA): the view (`?view=teams`, else players) and whether its read
     * failed. Players: `points` carry the impact values too (a failed read leaves the shooting points). Teams: `points` are the
     * season's teams (none when the read failed).
     */
    view?: { kind: ScatterView; failed: boolean };
}

export type ScatterView = 'players' | 'teams';

export type BasketballScatterPrep = { unavailable: true } | BasketballScatterParams;

export async function prepareBasketballScatter(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballScatterPrep> {
    Astro.locals.league = league;
    const cfg = BASKETBALL[league];
    const ft = cfg.featuredTeam;
    const resolved = resolveBasketballSeason(Astro, league);
    const coverageP = readCoverageNote(league, resolved.season);
    const confP = isNcaaDashboards(league) ? retrieveConferenceRows(resolved.season, league) : undefined;
    confP?.catch(() => {});
    const kind: ScatterView | undefined = PRO_LEAGUES.includes(league) && isFeatureEnabled('bball-impact-scatter', Astro.locals)
        ? (Astro.url.searchParams.get('view') === 'teams' ? 'teams' : 'players') : undefined;
    const viewP = kind === 'players' ? retrieveSeasonImpact(league, resolved.season) : kind === 'teams' ? retrieveSeasonTeamStrength(league, resolved.season) : undefined;
    viewP?.catch(() => {});
    const rows = await readBasketballSeasonRows(Astro, league, resolved.season, leaguePath(league, '/scatter'));
    if (rows === null) return { unavailable: true };
    const min = rankMins(league, resolved.season);
    // D42/D46 (R2): the college scatter shows one conference (computed default) or All D-I; only the chosen rows become points
    let conference: { options: ConferenceOption[]; selected: string } | undefined;
    let shown = rows;
    if (confP) {
        try {
            const c = await confP;
            const options = scatterConferenceOptions(c.teams, c.groups, resolved.season, league);
            const asked = Astro.url.searchParams.get('conference');
            const selected = asked === 'all' || options.some((o) => o.slug === asked) ? asked! : defaultScatterConference(rows, c.teams, resolved.season, league);
            conference = { options, selected };
            shown = filterByConference(rows, c.teams, selected);
        } catch (e: any) {
            console.error(`ERROR while loading the ${league} conferences for the ${resolved.season} scatter: ${e}, ${e?.stack}`);
            uncacheable(Astro); // decorative: All D-I, no selector
        }
    }
    let points = scatterPoints(playerSeasonsFromRows(shown), headshotsFromRows(shown), ft?.statsTeamId ?? null, { colorOf: (id) => cfg.teams.inSeason(id, resolved.season)?.color, min });
    let view: BasketballScatterParams['view'];
    if (kind && viewP) {
        try {
            const viewRows = await viewP;
            points = kind === 'players' ? withImpact(points, viewRows)
                : teamPoints(viewRows, (id) => cfg.teams.inSeason(id, resolved.season), ft?.statsTeamId ?? null, (t) => teamLogoUrl(league, t.espn_id, false, resolved.season));
            view = { kind, failed: false };
        } catch (e: any) {
            console.error(`ERROR while loading the ${league} ${resolved.season} scatter's ${kind} view: ${e}, ${e?.stack}`);
            uncacheable(Astro); // players keep the shooting axes; teams say the numbers are unavailable
            if (kind === 'teams') points = [];
            view = { kind, failed: true };
        }
    }
    const coverage = await coverageP;
    if (coverage === undefined) uncacheable(Astro);
    return { ...resolved, points, min, ...(isNcaaDashboards(league) ? { coverage: coverage ?? null } : {}), ...(conference ? { conference } : {}), ...(view ? { view } : {}) };
}
