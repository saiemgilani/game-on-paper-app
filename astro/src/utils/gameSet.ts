import { DateTime } from 'luxon';
import type { SDVGame, SDVTeamOpponentSplit } from '../resources/sdv';
import { LEAGUES, type League } from './league';
import { cleanTextForTeam, numberOrNull, type MetricFormat } from './misc';
import { rankIn } from './teamSplits';

/**
 * A team-season's games from `{league}.team_opponent_splits`, one row per
 * team-game. Season numbers are count-weighted sums over the rows, never the
 * mean of the per-game rates.
 */
/**
 * Every per-game rate the rows carry: its column, the count column it is a rate
 * over (its season average is weighted by that count: plays, dropbacks or
 * rushes), the metric-register key that titles it (`generateTeamMetricTitle`),
 * and its cell format. The producers compute every rate (cfb-data #141, nfl-data
 * #82); GOP only weights them into a season line. A rate column the table gains
 * is one entry here; `test/gameSet.test.ts` fails until it is added.
 */
export const GAME_METRICS = [
    { column: 'epa_per_play', weight: 'plays', key: 'EPAplay', format: 'num2' },
    { column: 'epa_per_pass', weight: 'pass_plays', key: 'EPAplay_pass', format: 'num2' },
    { column: 'epa_per_rush', weight: 'rush_plays', key: 'EPAplay_rush', format: 'num2' },
    { column: 'success_rate', weight: 'plays', key: 'success', format: 'pct' },
    { column: 'success_rate_pass', weight: 'pass_plays', key: 'success_pass', format: 'pct' },
    { column: 'success_rate_rush', weight: 'rush_plays', key: 'success_rush', format: 'pct' },
] as const satisfies readonly { column: keyof SDVTeamOpponentSplit, weight: keyof SDVTeamOpponentSplit, key: string, format: MetricFormat }[];
export type GameMetric = (typeof GAME_METRICS)[number]['column'];
export type GameSplits = { team: SDVTeamOpponentSplit[], opponent: SDVTeamOpponentSplit[] };

/**
 * The metrics with a value in at least one of the team's games. A season the
 * producers have not rebuilt since a column was added carries it as null (or,
 * from an older cached body, not at all), and offers only the metrics it has.
 */
export function availableMetrics(splits: GameSplits): (typeof GAME_METRICS)[number][] {
    return GAME_METRICS.filter((m) => splits.team.some((r) => numberOrNull(r[m.column]) !== null));
}

/** Each rate weighted by its own count in each game; a null rate or a zero count carries no weight. */
export function aggregateGames(rows: SDVTeamOpponentSplit[]): { games: number, plays: number } & Record<GameMetric, number | null> {
    const weighted = ({ column, weight }: (typeof GAME_METRICS)[number]) => {
        let sum = 0, total = 0;
        for (const r of rows) {
            const v = numberOrNull(r[column]), n = numberOrNull(r[weight]);
            if (v === null || !n) continue;
            sum += v * n;
            total += n;
        }
        return total > 0 ? sum / total : null;
    };
    return {
        games: rows.length,
        plays: rows.reduce((s, r) => s + (numberOrNull(r.plays) ?? 0), 0),
        ...(Object.fromEntries(GAME_METRICS.map((m) => [m.column, weighted(m)])) as Record<GameMetric, number | null>),
    };
}

export interface OpponentBar {
    /** the axis label: "9/27 at UGA" / "11/8 vs LSU" */
    label: string
    /** the tooltip title: "9/27/2025 at Georgia Bulldogs (W 24-21)" */
    title: string
    /** the team's own value in the game */
    raw: number | null
    /** the team's value minus its opponent's in the same game */
    margin: number | null
}

// what the chart is handed: six decimals, where the axis prints two (EPA) or one
// of a percent; a full float per value only bloats the page's island props
const chartValue = (x: number | null) => (x === null ? null : Math.round(x * 1e6) / 1e6);

// the kickoff's date in Eastern time, as the schedule and the game page's SEO
// line print it: a 7:30pm ET Saturday is Sunday in UTC. The title's is luxon's
// DATE_SHORT, the matchup history's format; the axis drops the season's year.
const kickoffDate = (start: string | undefined) => {
    const d = start ? DateTime.fromISO(start, { zone: 'America/New_York' }) : null;
    return d?.isValid ? { short: d.toFormat('M/d'), full: d.setLocale('en-US').toLocaleString(DateTime.DATE_SHORT) } : null;
};

const result = (r: SDVTeamOpponentSplit) => {
    const pf = numberOrNull(r.points_for), pa = numberOrNull(r.points_against);
    if (pf === null || pa === null) return '';
    return ` (${pf > pa ? 'W' : pf < pa ? 'L' : 'T'} ${pf}-${pa})`;
};

/**
 * One bar per game the team played, in kickoff order: the schedule's
 * `start_date`, so a rescheduled game sits where it was played. Without a
 * kickoff for every game, season type then week (kickoff, then id, break the
 * postseason's week-1 ties). The label and name come from the schedule, so the
 * NFL rows, which carry no opponent name, get one too.
 */
export function opponentBars(splits: GameSplits, events: SDVGame[], metric: GameMetric): OpponentBar[] {
    const eventOf = new Map(events.map((e) => [String(e.game_id), e]));
    const against = new Map(splits.opponent.map((r) => [String(r.game_id), r]));
    const kickoff = (r: SDVTeamOpponentSplit) => eventOf.get(String(r.game_id))?.start_date ?? '';
    // one ordering for the whole list: mixing date and week comparisons is not transitive
    const dated = splits.team.every((r) => kickoff(r) !== '');
    return splits.team
        .toSorted((a, b) => (dated ? 0 : (a.season_type - b.season_type) || (a.week - b.week)) || kickoff(a).localeCompare(kickoff(b)) || (a.game_id - b.game_id))
        .map((r) => {
            const e = eventOf.get(String(r.game_id));
            const home = e ? String(e.home_id) === String(r.team_id) : r.is_home;
            const atVs = home || e?.neutral_site ? 'vs' : 'at';
            const name = (e ? (home ? e.away_team : e.home_team) : r.opponent) || String(r.opponent_id);
            const abbreviation = e && (home ? e.away_abbreviation : e.home_abbreviation);
            const raw = numberOrNull(r[metric]);
            const theirs = numberOrNull(against.get(String(r.game_id))?.[metric]);
            const date = kickoffDate(e?.start_date);
            return {
                label: `${date ? `${date.short} ` : ''}${atVs} ${cleanTextForTeam(abbreviation || name, r.opponent_id)}`,
                title: `${date ? `${date.full} ` : ''}${atVs} ${cleanTextForTeam(name, r.opponent_id)}${result(r)}`,
                raw: chartValue(raw),
                margin: raw === null || theirs === null ? null : chartValue(raw - theirs),
            };
        });
}

/** The dashed season-average line for each view: raw, and offense minus defense over the games with both sides. */
export function opponentAverages(splits: GameSplits, metric: GameMetric): { raw: number | null, margin: number | null } {
    const has = (r: SDVTeamOpponentSplit | undefined) => numberOrNull(r?.[metric]) !== null;
    const against = new Map(splits.opponent.map((r) => [String(r.game_id), r]));
    const paired = splits.team.filter((r) => has(r) && has(against.get(String(r.game_id))));
    const off = aggregateGames(paired)[metric];
    const def = aggregateGames(paired.map((r) => against.get(String(r.game_id))!))[metric];
    return {
        raw: chartValue(aggregateGames(splits.team)[metric]),
        margin: off === null || def === null ? null : chartValue(off - def),
    };
}

/**
 * Bounds the value axis must reach besides the bars: zero, and the season-average
 * line. Chart.js sizes the axis from the bars alone, and in the Margin view the
 * average (offense minus defense, each weighted by its own plays) can sit beyond
 * every bar, where the line would be drawn outside the chart.
 */
export function averageAxisBounds(average: number | null): { suggestedMin: number, suggestedMax: number } {
    return { suggestedMin: Math.min(0, average ?? 0), suggestedMax: Math.max(0, average ?? 0) };
}

// ---- game sets ('game-set-filter') ------------------------------------------
// The Team Stats panel on the season team page: the team's line over a subset
// of its games (`?games=`), ranked against the same subset of every other
// team's games. Everything is summed from team_opponent_splits rows: rates are
// weighted by plays (aggregateGames), wins and losses are the rows' points,
// "last 4" is season type then week. Conference games and FBS opponents come
// from the season's team_summaries membership (team -> conference), so the
// team and its rank population are cut by one rule.

export const GAME_SETS = [
    { key: 'all', label: 'All Games' },
    { key: 'conf', label: 'Conference Games' },
    { key: 'nofcs', label: 'vs FBS', leagues: ['cfb'] },
    { key: 'home', label: 'Home' },
    { key: 'away', label: 'Away' },
    { key: 'wins', label: 'Wins' },
    { key: 'losses', label: 'Losses' },
    { key: 'last4', label: 'Last 4 Games' },
] as const satisfies readonly { key: string, label: string, leagues?: readonly League[] }[];
export type GameSet = (typeof GAME_SETS)[number]['key'];

const inLeague = (s: (typeof GAME_SETS)[number], league: League) => !('leagues' in s) || (s.leagues as readonly League[]).includes(league);

/** The `?games=` value as a set this league offers; anything else is `all`. */
export function gameSetOf(param: string | null | undefined, league: League): GameSet {
    return GAME_SETS.find((s) => s.key === param && inLeague(s, league))?.key ?? 'all';
}

/** team_id -> conference for the season's FBS (or NFL) teams: the rank population. */
export type SeasonTeams = Map<string, string | null>;
export function seasonTeams(rows: { team_id?: unknown, conference?: unknown }[]): SeasonTeams {
    return new Map(rows.filter((r) => r.team_id !== null && r.team_id !== undefined)
        .map((r) => [String(r.team_id), typeof r.conference === 'string' && r.conference ? r.conference : null]));
}

// ponytail: CFB's independents share one team_summaries value ("FBS Independents"),
// which is not a conference; a membership flag on the row would replace this test
const conferenceOf = (teams: SeasonTeams, id: unknown) => {
    const c = teams.get(String(id));
    return c && !/independent/i.test(c) ? c : null;
};

// the rows carry no kickoff: season type, then week. The postseason is all
// week 1 and its game ids are not in kickoff order, but no team plays more
// than four postseason games, so which four are last never depends on the tie
const byWeek = (a: SDVTeamOpponentSplit, b: SDVTeamOpponentSplit) =>
    (a.season_type - b.season_type) || (a.week - b.week) || (a.game_id - b.game_id);

/** One team's rows (`team_opponent_splits`, team side) cut to a game set. */
export function applyGameSet(rows: SDVTeamOpponentSplit[], set: GameSet, teams: SeasonTeams): SDVTeamOpponentSplit[] {
    const pf = (r: SDVTeamOpponentSplit) => numberOrNull(r.points_for), pa = (r: SDVTeamOpponentSplit) => numberOrNull(r.points_against);
    switch (set) {
        // regular season only: a CFP game between two members is not a conference game
        case 'conf': return rows.filter((r) => r.season_type === 2 && conferenceOf(teams, r.team_id) !== null && conferenceOf(teams, r.team_id) === conferenceOf(teams, r.opponent_id));
        case 'nofcs': return rows.filter((r) => teams.has(String(r.opponent_id)));
        case 'home': return rows.filter((r) => r.is_home === true);
        case 'away': return rows.filter((r) => r.is_home === false);
        case 'wins': return rows.filter((r) => pf(r) !== null && pa(r) !== null && pf(r)! > pa(r)!);
        case 'losses': return rows.filter((r) => pf(r) !== null && pa(r) !== null && pf(r)! < pa(r)!);
        case 'last4': return rows.toSorted(byWeek).slice(-4);
        default: return rows;
    }
}

/** The panel's columns; points are per game, and fewer points allowed is better. */
export const GAME_SET_COLUMNS = [
    { key: 'epa_per_play', label: 'Off EPA/Play', format: 'num2', lowerIsBetter: false },
    { key: 'success_rate', label: 'Off Success Rate', format: 'pct', lowerIsBetter: false },
    { key: 'points_for', label: 'Points For', format: 'num1', lowerIsBetter: false },
    { key: 'points_against', label: 'Points Against', format: 'num1', lowerIsBetter: true },
] as const;
export type GameSetColumn = (typeof GAME_SET_COLUMNS)[number]['key'];
export type GameSetLine = { games: number } & Record<GameSetColumn, number | null>;

/** A set of games as one line: rates weighted by plays, points per game over the games that have a score. */
export function gameSetLine(rows: SDVTeamOpponentSplit[]): GameSetLine {
    const perGame = (key: 'points_for' | 'points_against') => {
        const pts = rows.map((r) => numberOrNull(r[key])).filter((v): v is number => v !== null);
        return pts.length > 0 ? pts.reduce((s, v) => s + v, 0) / pts.length : null;
    };
    const { games, epa_per_play, success_rate } = aggregateGames(rows);
    return { games, epa_per_play, success_rate, points_for: perGame('points_for'), points_against: perGame('points_against') };
}

export interface GameSetTable {
    set: GameSet;
    /** the sets this team has at least one game in, `all` first: the select's options */
    sets: GameSet[];
    line: GameSetLine;
    /** 1 is best; null when the team is outside the population (or has no value) */
    ranks: Record<GameSetColumn, number | null>;
    /** teams in the population with a game in this set: the ranks' scale */
    ranked: number;
    /** who they are: "FBS" / "NFL", or the conference for conference games */
    pool: string;
}

/**
 * The Team Stats panel for one team: its line over `set`, ranked against the
 * season's FBS (NFL) teams over the same set, or its conference's teams for
 * conference games. `season` is every team-game row of the season; `teams`
 * the season's team -> conference map. A set the team has no game in falls
 * back to `all`, so a shared link never renders an empty table.
 */
export function gameSetTable(season: SDVTeamOpponentSplit[], teams: SeasonTeams, teamId: string, requested: GameSet, league: League): GameSetTable {
    const byTeam = Map.groupBy(season, (r) => String(r.team_id));
    const own = byTeam.get(teamId) ?? [];
    const sets = GAME_SETS.filter((s) => inLeague(s, league) && (s.key === 'all' || applyGameSet(own, s.key, teams).length > 0)).map((s) => s.key);
    const set = sets.includes(requested) ? requested : 'all';
    const conference = set === 'conf' ? conferenceOf(teams, teamId) : null;
    const population = [...teams.keys()].filter((id) => set !== 'conf' || conferenceOf(teams, id) === conference);
    const lines = population.map((id) => gameSetLine(applyGameSet(byTeam.get(id) ?? [], set, teams))).filter((l) => l.games > 0);
    const line = gameSetLine(applyGameSet(own, set, teams));
    const ranked = teams.has(teamId);
    const ranks = Object.fromEntries(GAME_SET_COLUMNS.map((c) => [c.key,
        ranked ? rankIn(line[c.key], lines.map((l) => l[c.key]), c.lowerIsBetter ? 'def' : 'off') : null])) as Record<GameSetColumn, number | null>;
    return { set, sets, line, ranks, ranked: lines.length, pool: conference ?? LEAGUES[league].pool };
}
