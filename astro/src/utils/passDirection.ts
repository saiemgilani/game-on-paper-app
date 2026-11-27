/**
 * Behind 'team-pass-direction': the team-season page's Passing Direction panel. A side's pass attempts (sacks out),
 * grouped by the depth and direction sportsdataverse-py reads from ESPN's play text (`pass_depth`: short / deep;
 * `pass_direction`: left / middle / right), the same cells as the game page's Target Matrix
 * (components/game/metrics/PassingChart.astro). See `passDepthSplit` for what "short" and "deep" mean. The text
 * carries depth and direction from 2025 Week 9 on (2025 by week: 0-3.3% through Week 8, 89.8% in Week 9, 90-96% after;
 * 2026: 94-97% from Week 1), so a 2025 season charts only part of its attempts: `charted` and `coverage` say how many.
 */
import type { League } from './league';
import { numberOrNull } from './misc';

/**
 * Where ESPN's play text splits "short" from "deep", in air yards: deep is this many or more, short anything under it,
 * behind the line included. Measured 2026-11-26 on full seasons, the label read from the text with sportsdataverse-py's
 * own `\s(short|deep)\s` match against an air-yards figure from elsewhere:
 * - college, 20: every 2025 and 2026 pass attempt in `espn_cfb_pbp`, air yards from the text's catch / throw spot. At
 *   19 air yards 974 short / 4 deep, at 20 one short / 942 deep; 15 of 71,430 charted attempts cross the line, each a
 *   bad spot in the text (a "caught at Miami00" touchdown, a play written twice).
 * - NFL, 16: every 2006-2025 pass attempt in the sdv ESPN NFL release, air yards the league's own. At 15 air yards
 *   8,359 short / 29 deep, at 16 two short / 7,080 deep; 136 of 366,286 cross, each a throw into or at the end
 *   zone (124) or a reversed or nullified play.
 * The game page's Target Matrix labels its rows with it; the Alabama fixtures pin the college split in
 * test/passDirection.render.test.ts.
 */
export const passDepthSplit = (league: League): number => (league === 'nfl' ? 16 : 20);

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

/** The first season with charted attempts to speak of: 2023 has 42 across 40 games (Weeks 9-13), 2024 one, and every
 *  season 2004-2022 none (Data API pbp, each season read 2026-11-26). The page reads no pass plays for an earlier season, so no panel stands on one attempt. */
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
