import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';
import { builderUrl, chartLabelLayout, chartSummary, chartTitle, emptyChartMessage, keepPreviewSurface, LABEL_PX, median, metricDirection, metricRail, quadrantLabels, randomAxes } from '../src/utils/chartBuilder';

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

    test('metricDirection: lower-is-better metrics, their _pass/_rush variants, takeaways, and style columns', () => {
        // giveaways are bad for an offense; a defense's turnovers are takeaways
        expect(metricDirection('turnovers_off')).toBe('lower');
        expect(metricDirection('turnovers_def')).toBe('higher');
        expect(metricDirection('turnover_margin')).toBe('higher');
        expect(metricDirection('adj_off_epa')).toBe('higher');
        expect(metricDirection('adj_def_epa')).toBe('lower');
        expect(metricDirection('havoc_off')).toBe('lower');
        expect(metricDirection('havoc_def_pass')).toBe('higher');
        expect(metricDirection('play_stuffed_off_rush')).toBe('lower');
        expect(metricDirection('third_down_distance_off_rush')).toBe('lower');
        expect(metricDirection('third_down_distance_def_pass')).toBe('higher');
        expect(metricDirection('pts_per_opp_def')).toBe('lower');
        for (const m of ['passrate_off', 'rushrate_def', 'plays_def_pass', 'drivesgame_off_rush', 'playsdrive_off', 'off_strength_faced', 'def_strength_faced']) {
            expect(metricDirection(m)).toBeNull();
        }
        // every rail metric gets an answer
        for (const m of metricRail().flatMap((f) => f.metrics)) expect([null, 'higher', 'lower']).toContain(metricDirection(m.key));
    });

    test('quadrantLabels for a lower-is-better metric: its axis is flipped, so Better still reads up and right', () => {
        // v2 reverses an axis exactly when metricDirection says lower, so the caption follows the direction
        expect(metricDirection('turnovers_off')).toBe('lower');
        expect(quadrantLabels('Off Turnovers', 'Def Adj EPA/Play').topRight).toBe('Better Def Adj EPA/Play / Better Off Turnovers');
        // a style column has no better side: High/Low on the unflipped scale
        expect(quadrantLabels('Off Turnovers', 'Off Pass Rate', true, false)).toEqual({
            topRight: 'High Off Pass Rate / Better Off Turnovers', topLeft: 'High Off Pass Rate / Worse Off Turnovers',
            bottomRight: 'Low Off Pass Rate / Better Off Turnovers', bottomLeft: 'Low Off Pass Rate / Worse Off Turnovers',
        });
    });

    test('chartSummary: the medians and corner meanings as one sentence for screen readers', () => {
        const q = quadrantLabels('Off Adj EPA/Play', 'Def Adj EPA/Play');
        expect(chartSummary(136, { title: 'Off Adj EPA/Play', median: '0.01' }, { title: 'Def Adj EPA/Play', median: '-0.01' }, q)).toBe(
            '136 teams. Median Off Adj EPA/Play: 0.01. Median Def Adj EPA/Play: -0.01. '
            + 'Top right: Better Def Adj EPA/Play / Better Off Adj EPA/Play. Bottom left: Worse Def Adj EPA/Play / Worse Off Adj EPA/Play.');
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

    test('keepPreviewSurface prefixes /preview only when the builder was opened there', () => {
        const nfl = builderUrl('nfl', { season: 2025, x: 'a', y: 'b' });
        expect(keepPreviewSurface(nfl, '/preview/nfl/charts/builder')).toBe('/preview/nfl/charts/builder?season=2025&x=a&y=b');
        expect(keepPreviewSurface(nfl, '/preview')).toBe(`/preview${nfl}`);
        expect(keepPreviewSurface(nfl, '/nfl/charts/builder')).toBe(nfl);
        expect(keepPreviewSurface(nfl, '/previewer/charts/builder')).toBe(nfl);
    });

    // plot areas measured on the 2026 cfb chart: desktop 1280 (xl) and a 390 phone (xs)
    test.each([
        ['xl', { left: 57, right: 1103, top: 64, bottom: 688 }],
        ['lg', { left: 57, right: 900, top: 64, bottom: 560 }],
        ['xs', { left: 44, right: 358, top: 30, bottom: 213 }],
    ] as const)('chartLabelLayout (%s): MEDIAN labels, quadrant rows and the flip note never share a row', (viewport, area) => {
        const r = chartLabelLayout(area, viewport);
        expect(r.median).toBe(viewport === 'xs' ? 9 : 11);
        // text boxes as [top, bottom]: ascent above the baseline, 3px of descender below; MEDIAN boxes are their pills
        const box = (baseline: number, px: number, pill = false): [number, number] => [baseline - px - (pill ? 2 : 0), baseline + 3];
        const below = (a: [number, number], b: [number, number]) => expect(a[1]).toBeLessThan(b[0]); // a sits wholly above b
        const yHigh = box(r.medianY(-1e6), r.median, true);
        const yLow = box(r.medianY(1e6), r.median, true);
        const quadTop = box(r.quadrantTop, LABEL_PX.quadrant);
        const quadBottom = box(r.quadrantBottom, LABEL_PX.quadrant);
        const [note1, note2] = r.flipNote.map((b) => box(b, LABEL_PX.note));
        const xMedian = box(r.medianX, r.median, true);
        expect(quadTop[0]).toBeGreaterThanOrEqual(area.top);
        below(quadTop, yHigh);
        below(yLow, quadBottom);
        below(quadTop, note1);
        below(note1, note2);
        below(note2, quadBottom);
        below(quadBottom, xMedian);
        expect(xMedian[1]).toBeLessThanOrEqual(area.bottom);
        // the y label follows its line in between
        const mid = (area.top + area.bottom) / 2;
        expect(r.medianY(mid)).toBe(mid - 4);
        // the x label follows its line, and stays inside the plot at either edge
        expect(r.medianXCentre(500, 80)).toBe(500 > area.right - 44 ? area.right - 44 : 500);
        expect(r.medianXCentre(area.left, 80)).toBe(area.left + 44);
        expect(r.medianXCentre(area.right + 50, 80)).toBe(area.right - 44);
    });

    test('emptyChartMessage: null while either axis has values, one line naming what is missing otherwise', () => {
        const pts = cfb2026.map((r) => ({ x: r.red_zone_success_off_pass, y: r.success_off }));
        expect(emptyChartMessage(pts, 'red_zone_success_off_pass', 'success_off', 2026)).toBeNull();
        // the Data API answers an unknown column with no rows: the route hands the island []
        expect(emptyChartMessage([], 'pts_per_opp_off', 'adj_def_epa', '2024')).toBe('No data for Off Points/Opp vs Def Adj EPA/Play in 2024.');
        const noX = pts.map((p) => ({ ...p, x: null }));
        expect(emptyChartMessage(noX, 'red_zone_success_off_pass', 'success_off', 2026)).toMatch(/^No data for [^]+ in 2026\.$/);
        expect(emptyChartMessage(noX, 'red_zone_success_off_pass', 'success_off', 2026)).not.toContain(' vs ');
    });
});
