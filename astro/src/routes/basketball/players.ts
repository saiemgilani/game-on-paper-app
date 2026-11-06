// src/routes/basketball/players.ts
/**
 * Page-side step of /<league>/players?season=&team=&sort=&dir=: blazing-the-nets'
 * app/players/list/[season]/[team]/page.tsx. `team` is a tricode or ALL and defaults to the
 * season's featured team (the NBA's Nets: BKN, or NJN through 2012), or ALL for a league without one.
 * A tricode the season does not use but its franchise did in another season (NJN in 2020, SEA in 2010)
 * selects that franchise, so switching seasons from a relocated team's list does not 404; an unknown
 * tricode does. Sorting is server-side (?sort= and ?dir= are whitelisted, so a crafted query can only
 * cache a real page).
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { playerSeasonsFromRows } from '../../nba/adapters';
import type { Team } from '../../nba/data/teams';
import type { SortDir } from '../../nba/table';
import { PLAYER_COLUMNS, parseDir, parseSort, playerRows, sortPlayerRows, teamsFromSeasonRows, type PlayerRow, type PlayerSortKey } from '../../nba/tables';
import { leaguePath, type BasketballLeague } from '../../utils/league';
import { seasonCache, setCache, uncacheable } from './cache';
import { readBasketballSeasonRows, resolveBasketballSeason } from './season';

export interface BasketballPlayersParams {
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

export type BasketballPlayersPrep = { notFound: true } | { unavailable: true } | BasketballPlayersParams;

const PLAYER_SORT_KEYS = PLAYER_COLUMNS.map((c) => c.key);

export async function prepareBasketballPlayers(Astro: AstroGlobal, league: BasketballLeague): Promise<BasketballPlayersPrep> {
    Astro.locals.league = league;
    const ft = BASKETBALL[league].featuredTeam;
    const resolved = resolveBasketballSeason(Astro, league);
    const { season } = resolved;
    const defaults = { season: String(resolved.current), team: ft ? ft.tricode(season) : 'ALL' };
    const requested = (Astro.url.searchParams.get('team') || defaults.team).toUpperCase(); // `?team=` (empty) is the default too
    const sort = parseSort(PLAYER_SORT_KEYS, Astro.url.searchParams.get('sort'), 'attempts');
    const dir = parseDir(Astro.url.searchParams.get('dir'));

    const rows = await readBasketballSeasonRows(Astro, league, season, leaguePath(league, '/players'), false); // the cache is set below, after the 404 check
    if (rows === null) return { unavailable: true };
    if (rows.length === 0) {
        // not ingested yet: the empty page (readBasketballSeasonRows already made it uncacheable)
        return { ...resolved, teams: [], selected: null, team: requested === 'ALL' ? 'ALL' : defaults.team, defaults, rows: [], sort, dir };
    }
    const teams = teamsFromSeasonRows(rows, season, league);
    const selected = requested === 'ALL' ? null : (teams.find((t) => t.tricode === requested) ?? teams.find((t) => t.team_id === BASKETBALL[league].teams.franchiseOf(requested)));
    if (selected === undefined) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const players = selected ? playerSeasonsFromRows(rows, selected.team_id) : playerSeasonsFromRows(rows);
    setCache(Astro, seasonCache(league));
    return { ...resolved, teams, selected, team: selected?.tricode ?? 'ALL', defaults, rows: sortPlayerRows(playerRows(players), sort, dir), sort, dir };
}
