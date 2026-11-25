/**
 * Page-side step of /<league>/teams/compare for the four basketball leagues (BB-G60, behind 'bball-team-compare'): two to
 * four teams' season blocks side by side, the player compare page's `?ids=` / `?season=` scheme. Each team's reads are the
 * team page's own: its team_season_rates `all` split row and its team_strength row (resources/teamSeason.ts). Every value,
 * rank and percentile is the producer's; nothing is computed here. A failed read is the page's 503; an id with no row
 * that season keeps its card ("no line"), so a season switch never drops it from the comparison.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import type { Team } from '../../nba/data/teams';
import { retrieveRows } from '../../resources/sdv';
import { retrieveTeamStrength, type TeamSeasonRateRow, type TeamStrengthRow } from '../../resources/teamSeason';
import { MAX_COMPARE } from '../../utils/compare';
import { isFeatureEnabled } from '../../utils/features';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { playerCache, setCache, uncacheable } from './cache';
import { resolveBasketballSeason } from './season';

/** The season block's TTL (resources/teamSeason.ts): the season products move once a day. */
const TTL = 6 * 60 * 60;

export type TeamCompareEntry =
    /** `team`: the id is a team of that season with no row yet, so its card can still name it */
    | { id: number; missing: true; team?: Team }
    | { id: number; team: Team; rates: TeamSeasonRateRow; strength: TeamStrengthRow | null };

export interface TeamCompareParams {
    season: number;
    seasons: number[];
    current: number;
    entries: TeamCompareEntry[];
    /** the add control: the season's teams not already compared, by name */
    teams: Team[];
}

export type TeamComparePrep = { notFound: true } | { unavailable: true } | TeamCompareParams;

/** ?ids=: up to four positive integer team ids, deduped, in order. */
export function parseTeamIds(raw: string | null): number[] {
    const ids = (raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^[1-9]\d{0,11}$/.test(s)).map(Number);
    return [...new Set(ids)].slice(0, MAX_COMPARE);
}

/** The compare page for these team ids and season (the current season is the default, so it stays off the URL). */
export function teamCompareHref(league: BasketballLeague, ids: number[], season: number, current: number): string {
    const q = new URLSearchParams();
    if (ids.length > 0) q.set('ids', ids.join(','));
    if (season !== current) q.set('season', String(season));
    const qs = q.toString().replaceAll('%2C', ',');
    return leaguePath(league, '/teams/compare') + (qs ? `?${qs}` : '');
}

export async function prepareTeamCompare(Astro: AstroGlobal, league: BasketballLeague): Promise<TeamComparePrep> {
    Astro.locals.league = league;
    if (!isFeatureEnabled('bball-team-compare', Astro.locals)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const { season, seasons, current } = resolveBasketballSeason(Astro, league);
    const module = BASKETBALL[league].teams;
    const ids = parseTeamIds(Astro.url.searchParams.get('ids'));
    // a comparison is a query over the team pages, not a page of its own: no ?ids= permutation is indexed
    Astro.response.headers.set('X-Robots-Tag', 'noindex');
    // an id that is no team of this league (another league's, a typo) is a 404, not a "Team <id>" card
    if (ids.some((id) => module.seasonsOf(id, season) === undefined)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    // the strength section renders only with 'bball-team-strength', so its read is made only then
    const withStrength = isFeatureEnabled('bball-team-strength', Astro.locals);
    let entries: TeamCompareEntry[];
    try {
        entries = await Promise.all(ids.map(async (id): Promise<TeamCompareEntry> => {
            const team = module.inSeason(id, season);
            if (!team) return { id, missing: true };
            const [rates, strength] = await Promise.all([
                retrieveRows<TeamSeasonRateRow>(league, 'team_season_rates', { season: String(season), team_id: String(id), split: 'all', limit: '1' }, TTL, true),
                withStrength ? retrieveTeamStrength(league, season, id) : Promise.resolve(null),
            ]);
            return rates[0] ? { id, team, rates: rates[0], strength } : { id, missing: true, team };
        }));
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} team compare reads for ${ids.join(',')}: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    const teams = module.all
        .map((t) => module.inSeason(t.team_id, season))
        .filter((t): t is Team => t !== undefined && !ids.includes(t.team_id))
        .sort((a, b) => a.name.localeCompare(b.name));
    // a stale id or a team not yet rated: never hold the "no line" card for the cache window
    if (entries.some((e) => 'missing' in e)) uncacheable(Astro);
    else setCache(Astro, playerCache(league));
    return { season, seasons, current, entries, teams };
}
