// What the shot dashboards say and read for a league: the source table and the scope wording. College dashboards
// (shotDashboards 'ncaa') read plan #7's stats.ncaa.org tables, which hold the regular season AND the postseason (D23).
import { BASKETBALL } from './config';
import { fmtInt, fmtPct } from '../nba/format';
import { isTrue } from '../resources/nbaGame';
import type { CoverageRow } from '../resources/nbaShots';
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

/** D25: what USG% is on a college page, and why there is no PIE (plan #7: ESPN box scores; its box PIE does not reproduce stats.nba.com's). */
export const NCAA_USAGE_NOTE =
    'USG% here is box-score usage from ESPN box scores (field-goal attempts, free-throw attempts, turnovers and minutes); PIE is not shown because the box-score formula does not reproduce it.';

/**
 * D24/D29/D37: the season's shot_coverage numbers as a sentence, nothing inferred. A season with under half the charted
 * shots of the season with the most gets both counts; a season under plan #7's floors (0.94 placed, 0.95 attributed) says so.
 * `meets_floor` arrives as a boolean or the string 'True'/'true' (the Data API hands back either): read through isTrue.
 */
export function coverageNote(rows: readonly CoverageRow[], season: number, label: (season: number) => string): string | null {
    const r = rows.find((x) => Number(x.season) === season);
    if (!r) return null;
    const most = rows.reduce((a, x) => (Number(x.source_shots) > Number(a.source_shots) ? x : a), r);
    const parts = [
        // D48: "linked", never "by Division I teams": stats.ncaa.org charts D-I programs the release does not link to an ESPN id
        `stats.ncaa.org shot charts, ${label(season)}: ${fmtInt(r.source_shots)} shots, ${fmtInt(r.d1_shots)} from teams linked to an ESPN Division I team; ` +
            `${fmtInt(r.placed_shots)} placed on an ESPN game (${fmtPct(r.placed_share)} of Division I shots), ${fmtInt(r.attributed_shots)} with a named shooter ` +
            `(${fmtPct(r.attributed_share)} of placed).`,
        'Team and league charts count every placed shot; player tables count shots with a named shooter.',
    ];
    if (Number(r.source_shots) * 2 < Number(most.source_shots)) {
        parts.push(`${label(season)} has ${fmtInt(r.source_shots)} charted shots against ${fmtInt(most.source_shots)} in ${label(Number(most.season))}.`);
    }
    if (!isTrue(r.meets_floor)) parts.push("This season is under the dashboards' coverage floors (94% placed, 95% attributed).");
    return parts.join(' ');
}
