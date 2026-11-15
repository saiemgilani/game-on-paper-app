import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import titles from './fixtures/metric-titles.json';
import invertSort from './fixtures/metric-invert-sort.json';
import { generateTeamMetricTitle, shouldInvertSortForMetric } from '../src/utils/misc';
import { REGISTRY_WANTS_LOW, chartTitle, emptyChartMessage, lowerIsBetter, metricRail, metricTitle } from '../src/utils/chartBuilder';

// F13 T2: both fixtures were cut from main (de25aa6a) before any change -- every column in
// SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS, SDV_TEAM_METRIC_CATEGORIES.* and SDV_PLAYER_METRIC_CATEGORIES.*
// through generateTeamMetricTitle, and every (category, column) pair through shouldInvertSortForMetric.
const TITLES = titles as Record<string, string>;
const INVERT = invertSort as Record<string, Record<string, boolean>>;
const COLUMNS = Object.keys(TITLES);

// Flag on: the ONLY titles the registry changes. Each one was a raw key, a "Rushs" or a short form.
const REGISTRY_TITLES: Record<string, string> = {
    catchpct: 'Catch %',
    comp: 'Catches',
    dropbacks: 'Dropbacks',
    neutral_pass_oe_off: 'Off Neutral Pass Rate Over Expected',
    neutral_pass_rate_off: 'Off Neutral Pass Rate',
    neutral_xpass_rate_off: 'Off Neutral Expected Pass Rate',
    pass_oe_off: 'Off Pass Rate Over Expected',
    pass_rate_off: 'Off Pass Rate',
    plays_def_rush: 'Def Total Rushes',
    plays_off_rush: 'Off Total Rushes',
    playsdrive_def_rush: 'Def Rushes/Drive',
    playsdrive_off_rush: 'Off Rushes/Drive',
    playsgame_def_rush: 'Def Rushes/Game',
    playsgame_off_rush: 'Off Rushes/Game',
    pts_per_opp_def: 'Def Points/Scoring Opportunity',
    pts_per_opp_margin: 'Net Points/Scoring Opportunity',
    pts_per_opp_off: 'Off Points/Scoring Opportunity',
    sack_adj_yards: 'Sack-Adjusted Yards',
    targets: 'Targets',
    xpass_rate_off: 'Off Expected Pass Rate',
    yardsdropback: 'Yards/Dropback',
};

describe("flag off ('metric-registry' not in use): byte-identical to main", () => {
    test(`generateTeamMetricTitle reproduces the fixture for all ${COLUMNS.length} columns`, () => {
        expect(Object.fromEntries(COLUMNS.map((c) => [c, generateTeamMetricTitle(c)]))).toEqual(TITLES);
        expect(Object.fromEntries(COLUMNS.map((c) => [c, metricTitle(c, false)]))).toEqual(TITLES);
    });

    test('shouldInvertSortForMetric reproduces the fixture for every (category, column) pair', () => {
        const got = Object.fromEntries(Object.keys(INVERT).map((cat) => [cat, Object.fromEntries(COLUMNS.map((c) => [c, shouldInvertSortForMetric(cat, c)]))]));
        expect(got).toEqual(INVERT);
    });

    test("the chart builder's helpers default to the legacy path", () => {
        expect(metricRail()).toEqual(metricRail(undefined, false));
        expect(metricRail().flatMap((f) => f.metrics).every(({ key, title }) => title === TITLES[key])).toBe(true);
        expect(chartTitle('plays_off_rush', 'pts_per_opp_off', 2025, false)).toBe('Off Points/Opp vs Off Total Rushs (2025)');
        expect(emptyChartMessage([], 'plays_off_rush', 'success_off', 2025)).toBe('No data for Off Total Rushs vs Off Success % in 2025.');
        expect(lowerIsBetter('start_position_off', true)).toBe(false);
    });
});

describe("flag on: the registry's labels and polarity", () => {
    test('titles change for exactly the listed columns; every other column keeps its fixture title', () => {
        const changed = Object.fromEntries(COLUMNS.map((c) => [c, metricTitle(c, true)]).filter(([c, t]) => t !== TITLES[c]));
        expect(changed).toEqual(REGISTRY_TITLES);
    });

    test('the pass_/rush_ strip no longer eats a registered pass_ metric', () => {
        expect(generateTeamMetricTitle('pass_rate_off')).toBe('Off pass_rate_off');
        expect(metricTitle('pass_rate_off', true)).toBe('Off Pass Rate');
        // a suffixed column keeps the legacy title (the builder never shows _rank)
        expect(metricTitle('EPAplay_off_rank', true)).toBe(TITLES.EPAplay_off_rank);
        // an unregistered column too
        expect(metricTitle('turnovers_off', true)).toBe(generateTeamMetricTitle('turnovers_off'));
    });

    test('start_position flips: lower is better for an offense, higher for a defense, and nothing else moves', () => {
        const changed: string[] = [];
        for (const cat of Object.keys(INVERT)) {
            for (const c of COLUMNS) if (shouldInvertSortForMetric(cat, c, REGISTRY_WANTS_LOW) !== INVERT[cat][c]) changed.push(`${cat}/${c}`);
        }
        expect(changed.sort()).toEqual(['defensive/start_position_def', 'offensive/start_position_off']);
        expect(shouldInvertSortForMetric('offensive', 'start_position_off', REGISTRY_WANTS_LOW)).toBe(true);
        expect(shouldInvertSortForMetric('defensive', 'start_position_def', REGISTRY_WANTS_LOW)).toBe(false);
        expect(lowerIsBetter('start_position_off', true, true)).toBe(true);
        expect(lowerIsBetter('start_position_def', true, true)).toBe(false);
        // the old list still holds: havoc, stuffs, 3rd-down distance, turnovers
        for (const s of ['havoc', 'play_stuffed', 'third_down_distance', 'turnovers']) {
            expect(shouldInvertSortForMetric('offensive', `${s}_off`, REGISTRY_WANTS_LOW)).toBe(true);
        }
    });

    test("the chart builder's helpers pass the flag through", () => {
        expect(chartTitle('plays_off_rush', 'pts_per_opp_off', 2025, false, true)).toBe('Off Points/Scoring Opportunity vs Off Total Rushes (2025)');
        expect(emptyChartMessage([], 'plays_off_rush', 'success_off', 2025, true)).toBe('No data for Off Total Rushes vs Off Success % in 2025.');
        const rail = metricRail(undefined, true).flatMap((f) => f.metrics);
        expect(rail.find((m) => m.key === 'playsdrive_off_rush')?.title).toBe('Off Rushes/Drive');
        expect(rail.every(({ key, title }) => title === (REGISTRY_TITLES[key] ?? TITLES[key]))).toBe(true);
    });
});

test("misc.ts takes the registry as a parameter, never a value import: the registry ships in the builder's island only", () => {
    const imports = readFileSync(new URL('../src/utils/misc.ts', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.includes('metricRegistry'));
    expect(imports).toEqual(['import type { ResolvedMetric } from "../resources/metricRegistry";']);
});
