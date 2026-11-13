/**
 * Page-side step of /<league>/players/compare for the four basketball leagues (BB-G13, behind 'bball-compare'): the
 * football compare page's `?ids=` / `?season=` scheme (routes/compare.ts, #359) over the basketball player page's reads.
 * Each card's season, as football's: `?season=` for every card when given, else that player's latest season with a
 * shot_season_players row (his page's own season list, retrievePlayerSeasons, capped at the league's listed seasons).
 *
 * Each card season's shot_season_players read (the one the player page and /players already make, cached by season)
 * names its cards and fills their shooting rows, and the add control lists the asked-for (else the current) season's
 * teams, so every one of those reads must succeed or the page is a 503. A failed season-list read keeps his card on
 * the current season and the page uncached. Each player's Impact and Value reads
 * are the player page's own (readPlayerImpact / readDecorative, each behind its flag): decorative, so a failed one is that
 * card's dashes and an uncached page. An id with no row that season keeps its card ("no line"), so a season switch
 * never drops him from the comparison.
 */
import type { AstroGlobal } from 'astro';
import { headshotsFromRows, playerSeasonsFromRows, teamsOfPlayer } from '../../nba/adapters';
import type { PlayerSeason } from '../../nba/data/players';
import { retrievePlayerSeasons, retrieveSeasonPlayerRows, type SeasonPlayerRow } from '../../resources/nbaShots';
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
        /** the card's season: `?season=`, else his latest */
        season: number;
        /** present only with 'bball-impact' on; null when the read failed */
        impact?: PlayerImpactRow[] | null;
        /** present only with 'bball-war' on; null when the read failed */
        war?: PlayerWarRow[] | null;
    };

export interface BasketballCompareParams {
    /** `?season=`, or null for each player's latest */
    season: number | null;
    seasons: number[];
    current: number;
    entries: BasketballCompareEntry[];
    /** the add control's first step: the season's (no `?season=`: the current one's) teams, by tricode */
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
    const resolved = resolveBasketballSeason(Astro, league);
    const { seasons, current } = resolved;
    const season = Astro.url.searchParams.has('season') ? resolved.season : null;
    // the season tables key on numbers: `01629008` is 1629008, so canonical spellings, deduped (one card per player)
    const ids = [...new Set(parseCompareIds(Astro.url.searchParams.getAll('ids').join(',')).map((id) => String(Number(id))))];
    let degraded = false;
    // each card's season: the asked-for one, else his latest listed season with a row (null: none, a "no line" card)
    const cardSeasons = await Promise.all(ids.map(async (id): Promise<number | null> => {
        if (season !== null) return season;
        try {
            return (await retrievePlayerSeasons(Number(id), league)).filter((s) => seasons.includes(s)).at(-1) ?? null;
        } catch (e: any) {
            console.error(`ERROR while loading the ${league} seasons of player ${id} for player compare: ${e}, ${e?.stack}`);
            degraded = true;
            return current;
        }
    }));
    const control = season ?? current;
    const bySeason = new Map<number, SeasonPlayerRow[]>();
    try {
        const wanted = [...new Set([control, ...cardSeasons.filter((s): s is number => s !== null)])];
        const read = await Promise.all(wanted.map((s) => retrieveSeasonPlayerRows(s, league)));
        wanted.forEach((s, i) => bySeason.set(s, read[i]));
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season ?? 'latest'} season players for player compare: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    const rows = bySeason.get(control)!;
    const withImpact = isFeatureEnabled('bball-impact', Astro.locals);
    const withWar = isFeatureEnabled('bball-war', Astro.locals);

    // not ingested yet: never hold the empty page for the cache window
    if ([...bySeason.values()].some((r) => r.length === 0)) degraded = true;
    const entries = await Promise.all(ids.map(async (id, i): Promise<BasketballCompareEntry> => {
        const s = cardSeasons[i];
        const sRows = s === null ? [] : bySeason.get(s)!;
        const player = playerSeasonsFromRows(sRows).find((p) => p.person_id === Number(id));
        if (s === null || !player) {
            degraded = true; // a stale id or a transient omission: never hold the nameless card for the cache window
            return { id, missing: true };
        }
        const [impact, war] = await Promise.all([
            withImpact ? readPlayerImpact(league, s, player.person_id) : undefined,
            withWar ? readDecorative('WAR', league, s, player.person_id, retrievePlayerWar) : undefined,
        ]);
        if (impact === null || war === null) degraded = true;
        return {
            id, player, season: s, teams: teamsOfPlayer(sRows, player.person_id), headshot: headshotsFromRows(sRows).get(player.person_id) ?? null,
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
