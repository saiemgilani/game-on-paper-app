/**
 * Page-side step of /<league>/players/compare for the four basketball leagues (BB-G13, behind 'bball-compare'): the
 * football compare page's `?ids=` / `?season=` scheme (routes/compare.ts, #359) over the basketball player page's reads.
 * One season for every card (the basketball pages are season pages): `?season=`, else the league's current one.
 *
 * The season's shot_season_players read (the one the player page and /players already make, cached by season) names
 * every card and fills its shooting rows, so it must succeed or the page is a 503. Each player's Impact and Value reads
 * are the player page's own (readPlayerImpact / readDecorative, each behind its flag): decorative, so a failed one is that
 * card's dashes and an uncached page. An id with no row that season keeps its card ("no line"), so a season switch
 * never drops him from the comparison.
 */
import type { AstroGlobal } from 'astro';
import { headshotsFromRows, playerSeasonsFromRows, teamsOfPlayer } from '../../nba/adapters';
import type { PlayerSeason } from '../../nba/data/players';
import { retrieveSeasonPlayerRows } from '../../resources/nbaShots';
import type { PlayerImpactRow } from '../../resources/playerImpact';
import { retrievePlayerWar, type PlayerWarRow } from '../../resources/playerWar';
import { parseCompareIds } from '../../utils/compare';
import { isFeatureEnabled } from '../../utils/features';
import type { BasketballLeague } from '../../utils/league';
import { playerCache, setCache, uncacheable } from './cache';
import { readDecorative, readPlayerImpact } from './player';
import { resolveBasketballSeason } from './season';

export type BasketballCompareEntry =
    | { id: string; missing: true }
    | {
        id: string; player: PlayerSeason; teams: string[]; headshot: string | null;
        /** present only with 'bball-impact' on; null when the read failed */
        impact?: PlayerImpactRow[] | null;
        /** present only with 'bball-war' on; null when the read failed */
        war?: PlayerWarRow[] | null;
    };

export interface BasketballCompareParams {
    season: number;
    seasons: number[];
    current: number;
    entries: BasketballCompareEntry[];
    /** the add control's first step: the season's teams, by tricode */
    teams: { id: number; tricode: string }[];
    /** `?team=`, the add control's second step: that team's players not already compared */
    roster: PlayerSeason[] | null;
    team: number | null;
}

export type BasketballComparePrep = { notFound: true } | { unavailable: true } | BasketballCompareParams;

export async function prepareBasketballCompare(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballComparePrep> {
    Astro.locals.league = league;
    if (!isFeatureEnabled('bball-compare', Astro.locals)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const { season, seasons, current } = resolveBasketballSeason(Astro, league);
    // the season tables key on numbers: `01629008` is 1629008, so canonical spellings, deduped (one card per player)
    const ids = [...new Set(parseCompareIds(Astro.url.searchParams.getAll('ids').join(',')).map((id) => String(Number(id))))];
    let rows;
    try {
        rows = await retrieveSeasonPlayerRows(season, league);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} season players for player compare: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    const players = new Map(playerSeasonsFromRows(rows).map((p) => [p.person_id, p]));
    const headshots = headshotsFromRows(rows);
    const withImpact = isFeatureEnabled('bball-impact', Astro.locals);
    const withWar = isFeatureEnabled('bball-war', Astro.locals);

    let degraded = rows.length === 0; // not ingested yet: never hold the empty page for the cache window
    const entries = await Promise.all(ids.map(async (id): Promise<BasketballCompareEntry> => {
        const player = players.get(Number(id));
        if (!player) {
            degraded = true; // a stale id or a transient omission: never hold the nameless card for the cache window
            return { id, missing: true };
        }
        const [impact, war] = await Promise.all([
            withImpact ? readPlayerImpact(league, season, player.person_id) : undefined,
            withWar ? readDecorative('WAR', league, season, player.person_id, retrievePlayerWar) : undefined,
        ]);
        if (impact === null || war === null) degraded = true;
        return {
            id, player, teams: teamsOfPlayer(rows, player.person_id), headshot: headshots.get(player.person_id) ?? null,
            ...(impact !== undefined ? { impact } : {}), ...(war !== undefined ? { war } : {}),
        };
    }));

    const teams = [...new Map(rows.filter((r) => r.team_id !== 0).map((r) => [r.team_id, { id: r.team_id, tricode: r.team_tricode }])).values()]
        .sort((a, b) => a.tricode.localeCompare(b.tricode));
    const teamParam = Number(Astro.url.searchParams.get('team'));
    const team = teams.some((t) => t.id === teamParam) ? teamParam : null;
    const roster = team === null ? null : playerSeasonsFromRows(rows, team)
        .filter((p) => !ids.includes(String(p.person_id)))
        .sort((a, b) => a.player_name.localeCompare(b.player_name));

    if (degraded) uncacheable(Astro);
    else setCache(Astro, playerCache(league));
    return { season, seasons, current, entries, teams, roster, team };
}
