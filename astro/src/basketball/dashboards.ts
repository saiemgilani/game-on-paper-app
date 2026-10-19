// What the shot dashboards say and read for a league: the source table and the scope wording. College dashboards
// (shotDashboards 'ncaa') read plan #7's stats.ncaa.org tables, which hold the regular season AND the postseason (D23).
import { BASKETBALL } from './config';
import type { BasketballLeague } from '../utils/league';

export const isNcaaDashboards = (league: BasketballLeague): boolean => BASKETBALL[league].shotDashboards === 'ncaa';

/** The per-subject shots table: nba_stats/wnba_stats `shots`, or the college `shot_rows` (same six lite columns, same frame). */
export const shotsTable = (league: BasketballLeague): 'shots' | 'shot_rows' => (isNcaaDashboards(league) ? 'shot_rows' : 'shots');

/** College seasons with no postseason: the 2020 tournaments were cancelled (plan #7 measured facts; Task 2 pins 0 type-3 games). */
export const NCAA_NO_POSTSEASON: readonly number[] = [2020];

export interface DashboardScope {
    /** after a season label: "2025-26 regular season" */
    noun: string;
    /** before a noun: "regular-season shooting line" */
    adj: string;
    /** after "from": where the shots come from */
    source: string;
    /** what the player explorer's league lines cover */
    leagueLines: string;
}

/** The dashboards' scope wording; the NBA's and WNBA's are today's literals, byte for byte. */
export function dashboardScope(league: BasketballLeague, season: number): DashboardScope {
    if (!isNcaaDashboards(league)) {
        return { noun: 'regular season', adj: 'regular-season', source: `${BASKETBALL[league].statsSourceLabel} play-by-play`, leagueLines: 'full regular season' };
    }
    const source = `${BASKETBALL[league].statsSourceLabel} shot charts`;
    if (NCAA_NO_POSTSEASON.includes(season)) {
        return { noun: `regular season (no ${season} postseason: the tournaments were cancelled)`, adj: 'regular-season', source, leagueLines: 'full regular season' };
    }
    return { noun: 'regular season + postseason', adj: 'regular-season and postseason', source, leagueLines: 'full regular season + postseason' };
}
