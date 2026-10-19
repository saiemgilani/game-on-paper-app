// What the shot dashboards say and read for a league: the source table and the scope wording. College dashboards
// (shotDashboards 'ncaa') read plan #7's stats.ncaa.org tables, which hold the regular season AND the postseason (D23).
import { BASKETBALL } from './config';
import { fmtInt, fmtPct } from '../nba/format';
import { isTrue } from '../resources/nbaGame';
import type { Team } from '../nba/data/teams';
import type { CoverageRow, GroupRow, ScheduleTeamRow, TeamGroupRow } from '../resources/nbaShots';
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

export interface ConferenceGroup {
    /** the reference conference id (`mbb:acc`), or '' for teams with no conference row that season */
    id: string;
    label: string;
    teams: Team[];
}

/**
 * The season's teams by their conference that season: conferences A to Z by short name, teams A to Z by name, teams the
 * reference does not place last under "Other Division I". Reference ids are text: a team id is a number only when it is
 * all digits (anything else is dropped and logged, never cast).
 */
export function conferenceGroups(teams: readonly Team[], teamRows: readonly TeamGroupRow[], groups: readonly GroupRow[]): ConferenceGroup[] {
    const names = new Map(groups.map((g) => [String(g.group_id), String(g.short_name)]));
    const confOf = new Map<number, string>();
    for (const r of teamRows) {
        if (!/^\d+$/.test(String(r.team_id))) {
            console.warn(`team_group_seasons: dropped a non-numeric team_id ${JSON.stringify(r.team_id)}`);
            continue;
        }
        confOf.set(Number(r.team_id), String(r.conference_id));
    }
    const by = new Map<string, Team[]>();
    for (const t of teams) {
        const id = confOf.get(t.team_id) ?? '';
        by.set(id, [...(by.get(id) ?? []), t]);
    }
    return [...by]
        .map(([id, ts]) => ({ id, label: id === '' ? 'Other Division I' : (names.get(id) ?? id), teams: [...ts].sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => (a.id === '' ? 1 : b.id === '' ? -1 : a.label.localeCompare(b.label)));
}

/**
 * Owner rulings D43/D47 (resolution R7), the ONE membership rule for college pages: a season's members are the ids with a
 * conference row that season that appear as home or away in that season's schedule (a conference row alone keeps 2020-21's
 * non-playing Ivy League; ESPN's core list alone keeps Hartford). Each member is its row-derived team from `teams` when it has
 * shots, else `teams.inSeason(id, season)` of the league's module; an id that resolves to neither is logged and dropped.
 * Selection only. Plan #11 reuses it for the women.
 */
export function withSeasonMembers(teams: readonly Team[], groupRows: readonly TeamGroupRow[], gameRows: readonly ScheduleTeamRow[], season: number, league: BasketballLeague): Team[] {
    const played = new Set<number>();
    for (const g of gameRows) for (const id of [g.home_id, g.away_id]) if (id != null && /^\d+$/.test(String(id))) played.add(Number(id));
    const byId = new Map(teams.map((t) => [t.team_id, t]));
    const out: Team[] = [];
    const seen = new Set<number>();
    for (const r of groupRows) {
        if (!/^\d+$/.test(String(r.team_id))) {
            console.warn(`${league} ${season} team_group_seasons: dropped a non-numeric team_id ${JSON.stringify(r.team_id)}`);
            continue;
        }
        const id = Number(r.team_id);
        if (seen.has(id) || !played.has(id)) continue;
        seen.add(id);
        const team = byId.get(id) ?? BASKETBALL[league].teams.inSeason(id, season);
        if (team) out.push(team);
        else console.warn(`${league} ${season}: conference member ${id} is in no team module; dropped`);
    }
    return out;
}

/**
 * R-P11: which of `seasons` a college team's season picker offers (and the players page carries ?team= into): its member
 * seasons from the committed table, plus `season` itself (the page's own read decided it) and any season after the table.
 * undefined for a league without the table (the NBA/WNBA keep TeamModule.seasonsOf).
 */
export function memberSeasonsOf(league: BasketballLeague, teamId: number, season: number, seasons: readonly number[]): number[] | undefined {
    const table = BASKETBALL[league].memberSeasons;
    if (!table) return undefined;
    const own = table.seasons.get(teamId) ?? [];
    return seasons.filter((s) => s === season || s > table.through || own.includes(s));
}
