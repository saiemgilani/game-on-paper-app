/**
 * BB-G52's page step: ?side=offense|defense, ?p=<id>&s=on|off (repeated, up to five; on defense also ?op=<id>&os=on|off over
 * the shooting opponents' five), the side's season of shot_lineups and
 * (college) the crosswalk, filtered here. A season before the table's first, or one it holds no row of, is 'unavailable';
 * a failed read is 'error' (the caller leaves the page uncached). Never throws: the section is decorative.
 */
import type { AstroGlobal } from 'astro';
import { courtFor, placeholderFor } from '../../basketball/config';
import { isNcaaDashboards } from '../../basketball/dashboards';
import { leagueContextFromRows } from '../../nba/adapters';
import { LINEUP_SHOTS_FIRST_SEASON, lineupOptions, lineupShots, parseFilters, parseSide, type LineupShotsView } from '../../nba/lineupShots';
import { retrieveLineupCrosswalk, retrieveLineupShotRows } from '../../resources/lineupShots';
import type { LeagueContextRow, SeasonPlayerRow } from '../../resources/nbaShots';
import type { BasketballLeague } from '../../utils/league';

export async function readLineupShots(
    Astro: AstroGlobal, league: BasketballLeague, season: number, teamId: number, players: SeasonPlayerRow[], contextRows: LeagueContextRow[],
): Promise<LineupShotsView> {
    const q = Astro.url.searchParams;
    const side = parseSide(q.get('side'));
    if (season < LINEUP_SHOTS_FIRST_SEASON[league]) return { status: 'unavailable', side };
    try {
        // a failed crosswalk costs only the names (every player reads as #id), never the chart
        const [rows, crosswalk] = await Promise.all([
            retrieveLineupShotRows(season, teamId, side, league),
            // defense names the opponents too, so college reads the league's crosswalk there
            retrieveLineupCrosswalk(season, side === 'defense' ? null : teamId, league).catch((e: any) => {
                console.warn(`WARN the ${league} ${season} player crosswalk for team ${teamId} failed, lineup names fall back to ids: ${e}`);
                return [] as [string, string][];
            }),
        ]);
        if (!rows.length) return { status: 'unavailable', side };
        const byPerson = new Map(players.map((r) => [String(r.person_id), r.player_name]));
        // college lineups carry stats.ncaa.org ids and the season rows ESPN ids: names go through the crosswalk, never by id alone
        const names = isNcaaDashboards(league)
            ? new Map(crosswalk.flatMap(([ncaa, espn]) => (byPerson.has(espn) ? [[ncaa, byPerson.get(espn)!] as const] : [])))
            : byPerson;
        const options = lineupOptions(rows, side, names);
        const filters = parseFilters(q.getAll('p'), q.getAll('s'), new Set(options.map((o) => o.id)));
        const oppOptions = side === 'defense' ? lineupOptions(rows, side, names, 'opponent') : [];
        const oppFilters = parseFilters(q.getAll('op'), q.getAll('os'), new Set(oppOptions.map((o) => o.id)));
        return {
            status: 'ok',
            data: lineupShots(rows, side, filters, options, leagueContextFromRows(contextRows), courtFor(league, season), placeholderFor(league, season), { filters: oppFilters, options: oppOptions }),
        };
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} lineup shots for team ${teamId}: ${e}, ${e?.stack}`);
        return { status: 'error', side };
    }
}
