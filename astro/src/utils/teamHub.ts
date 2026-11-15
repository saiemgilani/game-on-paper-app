/**
 * The team profile's history tables ('team-hub'): best seasons, head-coach eras and
 * conference history (CFB), pivoted from rows the page already reads
 * (team_summaries for every season) plus the team's coach_tendencies rows.
 *
 * Spans carry `first_season` / `last_season` / `seasons` so `formatSeasonSpan`
 * (utils/coaches.ts) prints them the way the coach careers board does.
 */
import { numericValue, type CoachRow } from './coaches';

export type SeasonSpan = {
    first_season: number;
    last_season: number;
    /** seasons with a row, not last - first + 1: a season the data lacks is not counted */
    seasons: number;
}

export type CoachEra = SeasonSpan & { coach: string; games: number };
export type ConferenceSpan = SeasonSpan & { conference: string };

/**
 * Per metric, the season with the best (lowest) `<metric>_rank`; ties go to the most
 * recent season. A metric no row ranks is left out.
 */
export function bestSeasons<T extends { season: number }>(rows: T[], metrics: string[]): { metric: string; row: T }[] {
    const out: { metric: string; row: T }[] = [];
    for (const metric of metrics) {
        let best: T | null = null;
        let bestRank = Infinity;
        for (const row of rows) {
            const rank = numericValue(row as unknown as CoachRow, `${metric}_rank`);
            if (rank === null) continue;
            if (rank < bestRank || (rank === bestRank && row.season > best!.season)) {
                best = row;
                bestRank = rank;
            }
        }
        if (best) out.push({ metric, row: best });
    }
    return out;
}

/**
 * Head-coach eras, oldest first: one coach's seasons merge while they are consecutive
 * among the seasons the rows cover, so a coach who leaves and returns (Bill Snyder at
 * Kansas State) gets two eras, and a season missing from the data does not split one.
 * Two coaches in one season (a mid-season change) each keep that season.
 */
export function coachEras(rows: CoachRow[]): CoachEra[] {
    const seasons = [...new Set(rows.map((r) => numericValue(r, 'season')).filter((s): s is number => s !== null))].sort((a, b) => a - b);
    const index = new Map(seasons.map((s, i) => [s, i]));
    const eras: CoachEra[] = [];
    const open = new Map<string, CoachEra>();
    const sorted = rows.filter((r) => typeof r.coach === 'string' && r.coach && numericValue(r, 'season') !== null)
        .toSorted((a, b) => numericValue(a, 'season')! - numericValue(b, 'season')!);
    for (const r of sorted) {
        const coach = r.coach as string;
        const season = numericValue(r, 'season')!;
        const games = numericValue(r, 'games') ?? 0;
        const era = open.get(coach);
        if (era && index.get(season)! - index.get(era.last_season)! === 1) {
            era.last_season = season;
            era.seasons += 1;
            era.games += games;
        } else {
            const next = { coach, first_season: season, last_season: season, seasons: 1, games };
            eras.push(next);
            open.set(coach, next);
        }
    }
    return eras.toSorted((a, b) => a.first_season - b.first_season || a.last_season - b.last_season);
}

/** Runs of one conference, oldest first; each realignment starts a new run. */
export function conferenceSpans(rows: { season: number; conference?: string | null }[]): ConferenceSpan[] {
    const spans: ConferenceSpan[] = [];
    for (const r of rows.filter((r) => r.conference).toSorted((a, b) => a.season - b.season)) {
        const conference = r.conference!;
        const last = spans[spans.length - 1];
        if (last && last.conference === conference) {
            last.last_season = r.season;
            last.seasons += 1;
        } else {
            spans.push({ conference, first_season: r.season, last_season: r.season, seasons: 1 });
        }
    }
    return spans;
}
