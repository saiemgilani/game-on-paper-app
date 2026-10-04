import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';
import { builderUrl, chartTitle, median, metricRail, quadrantLabels, randomAxes } from '../src/utils/chartBuilder';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)).toString());
// The Data API's real 2026 cfb rows for x=red_zone_success_off_pass&y=success_off (fixtures/README.md):
// 138 teams, and Rice (242) has no red-zone pass value yet
const cfb2026 = fixture('team-summaries-cfb-2026-builder.json').data as Record<string, any>[];

describe('the chart-builder-v2 flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['chart-builder-v2']).toBe('preview');
        expect(isFeatureEnabled('chart-builder-v2', {})).toBe(false);
        expect(isFeatureEnabled('chart-builder-v2', { preview: true })).toBe(true);
    });
});

describe('chart builder helpers', () => {
    test('median keeps zeros and ignores non-finite values', () => {
        expect(median([0, 0, 1])).toBe(0);
        expect(median([3, 1, 2, 10])).toBe(2.5);
        expect(median([NaN, 4])).toBe(4);
        expect(median([null, undefined, 4])).toBe(4);
        expect(median([])).toBeNull();
    });

    test('median on real rows: an even-count season averages the middle two', () => {
        expect(cfb2026).toHaveLength(138);
        expect(median(cfb2026.map((r) => r.success_off))).toBe((0.43621399176954734 + 0.4369369369369369) / 2);
    });

    test('median on real rows: a null in the plotted column is skipped, not read as 0', () => {
        expect(cfb2026.filter((r) => r.red_zone_success_off_pass === null).map((r) => r.team_id)).toEqual([242]);
        // 137 values -> the 69th; counting Rice as 0 would give 0.3798…
        expect(median(cfb2026.map((r) => r.red_zone_success_off_pass))).toBe(0.38461538461538464);
    });

    test('metricRail: every plottable column once, in the fixed family order, canonical titles', () => {
        const rail = metricRail();
        expect(rail.map((f) => f.family)).toEqual(['Differential: Passing', 'Differential: Rushing', 'Differential: Other',
            'Offensive: Passing', 'Defensive: Passing', 'Offensive: Rushing', 'Defensive: Rushing', 'Offensive: Other', 'Defensive: Other']);
        const keys = rail.flatMap((f) => f.metrics.map((m) => m.key));
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.some((k) => k.endsWith('_rank'))).toBe(false);
        expect(keys).not.toContain('team_id');
        expect(rail.find((f) => f.family === 'Offensive: Other')!.metrics.find((m) => m.key === 'adj_off_epa')!.title).toBe('Off Adj EPA/Play');
    });

    test('chartTitle reads "Y vs X (season)", with (Filtered) when a filter is on', () => {
        expect(chartTitle('adj_off_epa', 'adj_def_epa', 2025, false)).toBe('Def Adj EPA/Play vs Off Adj EPA/Play (2025)');
        expect(chartTitle('adj_off_epa', 'adj_def_epa', 2025, true)).toBe('Def Adj EPA/Play vs Off Adj EPA/Play (2025) (Filtered)');
    });

    test('randomAxes returns two different keys and is deterministic for a given rand', () => {
        const seq = (xs: number[]) => { let i = 0; return () => xs[i++]; };
        expect(randomAxes(['a', 'b', 'c'], seq([0, 0]))).toEqual(['a', 'b']);
        expect(randomAxes(['a', 'b', 'c'], seq([0.99, 0.99]))).toEqual(['c', 'b']);
        for (let i = 0; i < 500; i++) { const [x, y] = randomAxes(['a', 'b', 'c']); expect(x).not.toBe(y); }
    });

    test('randomAxes over the real rail: two different rail metrics for every injected draw, edges included', () => {
        const keys = metricRail().flatMap((f) => f.metrics.map((m) => m.key));
        const rail = new Set(keys);
        const draws = [0, 1e-9, 0.25, 0.5, 0.75, 1 - 1e-9, ...Array.from({ length: 97 }, (_, i) => (i + 1) / 98)];
        for (const a of draws) for (const b of draws) {
            const [x, y] = randomAxes(keys, ((xs) => () => xs.shift()!)([a, b]));
            expect(rail.has(x) && rail.has(y)).toBe(true);
            expect(x).not.toBe(y);
        }
    });

    test('quadrantLabels: better is up and right, because the builder flips axes that way', () => {
        expect(quadrantLabels('Off EPA/Play', 'Def EPA/Play')).toEqual({
            topRight: 'Better Def EPA/Play / Better Off EPA/Play', topLeft: 'Better Def EPA/Play / Worse Off EPA/Play',
            bottomRight: 'Worse Def EPA/Play / Better Off EPA/Play', bottomLeft: 'Worse Def EPA/Play / Worse Off EPA/Play',
        });
    });

    test('builderUrl keeps the league prefix and drops default state', () => {
        expect(builderUrl('nfl', { season: 2025, x: 'a', y: 'b' })).toBe('/nfl/charts/builder?season=2025&x=a&y=b');
        expect(builderUrl('cfb', { season: 2025, x: 'a', y: 'b', hl: 'SEC', mode: 'dots' })).toBe('/charts/builder?season=2025&x=a&y=b&hl=SEC&mode=dots');
        expect(builderUrl('cfb', { season: 2025, x: 'a', y: 'b', hl: '  ', mode: 'logos' })).toBe('/charts/builder?season=2025&x=a&y=b');
    });
});
