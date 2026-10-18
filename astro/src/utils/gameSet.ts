import { DateTime } from 'luxon';
import type { SDVGame, SDVTeamOpponentSplit } from '../resources/sdv';
import { cleanTextForTeam, numberOrNull, type MetricFormat } from './misc';

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
