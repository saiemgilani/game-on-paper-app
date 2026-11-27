/**
 * Behind 'team-pass-direction': the team-season page's Passing Direction panel. A side's pass attempts (sacks out),
 * grouped by the depth and direction sportsdataverse-py reads from ESPN's play text (`pass_depth`: short / deep;
 * `pass_direction`: left / middle / right), the same cells as the game page's Target Matrix
 * (components/game/metrics/PassingChart.astro). ESPN's "deep" is a throw of 20+ air yards and "short" anything under,
 * behind the line included (2025-26 FBS charted attempts: 99.9% of deep at 20+, 99.98% of short under 20). The text
 * carries depth and direction from 2025 Week 9 on, so a season charts only part of its attempts: `charted` and
 * `coverage` say how many.
 */
import { numberOrNull } from './misc';

/** One pass attempt from the pbp table (the columns `retrieveTeamPassPlays` asks for). */
export interface PassPlay {
    game_id: string | number;
    sack?: boolean | null;
    completion?: boolean | null;
    pass_direction?: string | null;
    pass_depth?: string | null;
    /** text in the Data API */
    air_yards?: string | number | null;
    EPA?: number | null;
    EPA_success?: boolean | null;
}

export const PASS_PLAY_COLUMNS = ['game_id', 'sack', 'completion', 'pass_direction', 'pass_depth', 'air_yards', 'EPA', 'EPA_success'];

export const DEPTHS = [['short', 'Short'], ['deep', 'Deep']] as const;
export const DIRECTIONS = [['left', 'Left'], ['middle', 'Middle'], ['right', 'Right']] as const;

/** The first season with charted attempts to speak of: 2023 has 42 across 40 games, 2024 one, earlier none (Data API
 *  pbp, 2026-11-26). The page reads no pass plays for an earlier season, so no panel stands on one attempt. */
export const PASS_DIRECTION_FIRST_SEASON = 2025;

/** Below this share of charted attempts the panel says the season is partly charted. */
export const PASS_DIRECTION_COVERAGE_FLOOR = 0.9;

export interface DirectionRow {
    key: string;
    label: string;
    /** a direction under its depth row */
    sub: boolean;
    attempts: number;
    completions: number;
    /** of the side's charted attempts */
    share: number | null;
    epa_per_play: number | null;
    success_rate: number | null;
    /** mean air yards over the attempts that carry them */
    adot: number | null;
}

export interface DirectionTable {
    /** pass attempts, sacks out */
    attempts: number;
    /** attempts with both a depth and a direction */
    charted: number;
    coverage: number | null;
    rows: DirectionRow[];
}

const mean = (xs: number[]): number | null => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

function rowOf(key: string, label: string, sub: boolean, plays: PassPlay[], charted: number): DirectionRow {
    const epa = plays.map((p) => numberOrNull(p.EPA)).filter((x): x is number => x !== null);
    const success = plays.filter((p) => p.EPA_success !== null && p.EPA_success !== undefined).map((p) => (p.EPA_success ? 1 : 0));
    const air = plays.map((p) => numberOrNull(p.air_yards)).filter((x): x is number => x !== null);
    return {
        key, label, sub,
        attempts: plays.length,
        completions: plays.filter((p) => p.completion === true).length,
        share: charted > 0 ? plays.length / charted : null,
        epa_per_play: mean(epa),
        success_rate: mean(success),
        adot: mean(air),
    };
}

/** The panel's rows for one side: every charted attempt, then each depth with its three directions under it. */
export function passDirectionTable(plays: PassPlay[]): DirectionTable {
    const attempts = plays.filter((p) => p.sack !== true);
    const charted = attempts
        .map((p) => ({ p, depth: p.pass_depth?.toLowerCase(), dir: p.pass_direction?.toLowerCase() }))
        .filter(({ depth, dir }) => DEPTHS.some(([d]) => d === depth) && DIRECTIONS.some(([d]) => d === dir));
    const n = charted.length;
    const rows: DirectionRow[] = [rowOf('all', 'All', false, charted.map((c) => c.p), n)];
    for (const [depth, depthLabel] of DEPTHS) {
        const atDepth = charted.filter((c) => c.depth === depth);
        rows.push(rowOf(depth, depthLabel, false, atDepth.map((c) => c.p), n));
        for (const [dir, dirLabel] of DIRECTIONS) {
            rows.push(rowOf(`${depth}-${dir}`, dirLabel, true, atDepth.filter((c) => c.dir === dir).map((c) => c.p), n));
        }
    }
    return { attempts: attempts.length, charted: n, coverage: attempts.length ? n / attempts.length : null, rows };
}

/** Does either side chart an attempt? A season before ESPN's text carried depth and direction has no panel. */
export const anyCharted = (plays: { off: PassPlay[], def: PassPlay[] }): boolean =>
    passDirectionTable(plays.off).charted > 0 || passDirectionTable(plays.def).charted > 0;
