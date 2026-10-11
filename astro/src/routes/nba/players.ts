// src/routes/nba/players.ts
/**
 * Page-side step of /nba/players?season=&team=&sort=&dir=: blazing-the-nets'
 * app/players/list/[season]/[team]/page.tsx. `team` is a tricode or ALL and defaults to the
 * season's Nets (BKN, or NJN through 2012). A tricode the season does not use but its franchise
 * did in another season (NJN in 2020, SEA in 2010) selects that franchise, so switching seasons
 * from a relocated team's list does not 404; an unknown tricode does. Sorting is server-side
 * (?sort= and ?dir= are whitelisted, so a crafted query can only cache a real page).
 */
import type { AstroGlobal } from 'astro';
import { playerSeasonsFromRows } from '../../nba/adapters';
import { franchiseOf, type Team } from '../../nba/data/teams';
import { netsTricode } from '../../nba/seasonRange';
import type { SortDir } from '../../nba/table';
import { PLAYER_COLUMNS, parseDir, parseSort, playerRows, sortPlayerRows, teamsFromSeasonRows, type PlayerRow, type PlayerSortKey } from '../../nba/tables';
import { retrieveSeasonPlayerRows } from '../../resources/nbaShots';
import { SEASON_CACHE, setCache, uncacheable } from './cache';
import { resolveSeason } from './home';

export interface NbaPlayersParams {
    season: number;
    seasons: number[];
    current: number;
    q: string;
    teams: Team[];
    /** null for ALL */
    selected: Team | null;
    /** The tricode the page shows (the season's own spelling), or 'ALL'. */
    team: string;
    /** What the canonical URL leaves out. */
    defaults: { season: string; team: string };
    rows: PlayerRow[];
    sort: PlayerSortKey;
    dir: SortDir;
}

export type NbaPlayersPrep = { notFound: true } | { unavailable: true } | NbaPlayersParams;

const PLAYER_SORT_KEYS = PLAYER_COLUMNS.map((c) => c.key);

export async function prepareNbaPlayers(Astro: AstroGlobal): Promise<NbaPlayersPrep> {
    Astro.locals.league = 'nba';
    const resolved = resolveSeason(Astro);
    const { season } = resolved;
    const defaults = { season: String(resolved.current), team: netsTricode(season) };
    const requested = (Astro.url.searchParams.get('team') || defaults.team).toUpperCase(); // `?team=` (empty) is the default too
    const sort = parseSort(PLAYER_SORT_KEYS, Astro.url.searchParams.get('sort'), 'attempts');
    const dir = parseDir(Astro.url.searchParams.get('dir'));

    let rows;
    try {
        rows = await retrieveSeasonPlayerRows(season);
    } catch (e: any) {
        console.error(`ERROR while loading the ${season} season players for /nba/players: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    if (rows.length === 0) {
        // not ingested yet: the empty page, never cached for the season window
        uncacheable(Astro);
        return { ...resolved, teams: [], selected: null, team: requested === 'ALL' ? 'ALL' : defaults.team, defaults, rows: [], sort, dir };
    }
    const teams = teamsFromSeasonRows(rows, season);
    const selected = requested === 'ALL' ? null : (teams.find((t) => t.tricode === requested) ?? teams.find((t) => t.team_id === franchiseOf(requested)));
    if (selected === undefined) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const players = selected ? playerSeasonsFromRows(rows, selected.team_id) : playerSeasonsFromRows(rows);
    setCache(Astro, SEASON_CACHE);
    return { ...resolved, teams, selected, team: selected?.tricode ?? 'ALL', defaults, rows: sortPlayerRows(playerRows(players), sort, dir), sort, dir };
}
