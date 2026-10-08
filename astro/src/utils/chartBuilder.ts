/**
 * Chart Builder v2 ('chart-builder-v2'): the pure parts, tested without a
 * canvas. `components/charts/ChartBuilder.svelte` draws; this decides.
 */
import { SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS } from './constants';
import { leaguePath, type League } from './league';
import { generateCategoryForMetric, generateSubCategoryForMetric, generateTeamMetricTitle } from './misc';
import { PREVIEW_PATH_PREFIX } from './preview';

/** The caption colours the builder already draws in. */
export const CHART_TEXT = { light: '#525252', dark: '#e8e6e3' } as const;

export type MarkMode = 'logos' | 'dots';

/** Median of the finite values; a team with no value (null) is skipped, never read as 0. */
export function median(values: readonly (number | null | undefined)[]): number | null {
    const v = values.filter((n): n is number => Number.isFinite(n)).toSorted((a, b) => a - b);
    if (v.length === 0) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export interface RailFamily { family: string; metrics: { key: string; title: string }[] }
const FAMILY_ORDER = ['Differential: Passing', 'Differential: Rushing', 'Differential: Other', 'Offensive: Passing',
    'Defensive: Passing', 'Offensive: Rushing', 'Defensive: Rushing', 'Offensive: Other', 'Defensive: Other'];
const NOT_METRICS = ['fbs_class', 'valid_games', 'team_id', 'pos_team', 'division', 'conference', 'season'];

/** Every plottable team column once, grouped as the builder's selects group them today. */
export function metricRail(columns: string[] = SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS): RailFamily[] {
    const byFamily = new Map<string, RailFamily>();
    for (const m of columns) {
        if (NOT_METRICS.includes(m) || m.endsWith('_rank')) continue;
        if ((m.includes('passrate') && m.includes('_rush')) || (m.includes('rushrate') && m.includes('_pass'))) continue;
        const family = `${generateCategoryForMetric(m)}: ${generateSubCategoryForMetric(m)}`;
        if (!byFamily.has(family)) byFamily.set(family, { family, metrics: [] });
        byFamily.get(family)!.metrics.push({ key: m, title: generateTeamMetricTitle(m) });
    }
    return FAMILY_ORDER.filter((f) => byFamily.has(f)).map((f) => byFamily.get(f)!);
}

export function chartTitle(x: string, y: string, season: string | number, filtered: boolean): string {
    return `${generateTeamMetricTitle(y)} vs ${generateTeamMetricTitle(x)} (${season})${filtered ? ' (Filtered)' : ''}`;
}

/** Two different keys for the Random button; `rand` is injectable so tests are deterministic. */
export function randomAxes(keys: string[], rand: () => number = Math.random): [string, string] {
    const i = Math.floor(rand() * keys.length);
    let j = Math.floor(rand() * (keys.length - 1));
    if (j >= i) j += 1;
    return [keys[i], keys[j]];
}

export function quadrantLabels(xTitle: string, yTitle: string) {
    return {
        topRight: `Better ${yTitle} / Better ${xTitle}`, topLeft: `Better ${yTitle} / Worse ${xTitle}`,
        bottomRight: `Worse ${yTitle} / Better ${xTitle}`, bottomLeft: `Worse ${yTitle} / Worse ${xTitle}`,
    };
}

export interface PlotArea { left: number; right: number; top: number; bottom: number }
/** Text sizes on the v2 chart, in px: the quadrant labels, the two-line axis-flip note, and the MEDIAN labels (smaller on phones). */
export const LABEL_PX = { quadrant: 11, note: 8, line: 6 } as const;

/**
 * Where the v2 chart's text goes inside the plot area, as canvas baselines, so no two labels share a row:
 * the x MEDIAN label on the bottom edge, the bottom quadrant labels above it, the axis-flip note above those,
 * and the top quadrant labels under the top edge. The MEDIAN labels follow their lines but are kept off the
 * quadrant rows and inside the plot.
 */
export function chartLabelLayout(area: PlotArea, viewport: 'xs' | 'sm' | 'md' | 'lg' | 'xl') {
    const median = viewport === 'xs' || viewport === 'sm' ? 9 : 11;
    const row = LABEL_PX.quadrant + LABEL_PX.line;
    const medianX = area.bottom - 5;
    const quadrantBottom = medianX - median - LABEL_PX.line;
    const quadrantTop = area.top + LABEL_PX.quadrant + 2;
    const noteBottom = quadrantBottom - row;
    return {
        median,
        medianX,
        quadrantTop,
        quadrantBottom,
        flipNote: [noteBottom - LABEL_PX.note - 4, noteBottom] as [number, number],
        /** baseline of the y MEDIAN label: just above its line, between the quadrant rows */
        medianY: (linePx: number) => Math.min(Math.max(linePx - 4, quadrantTop + median + LABEL_PX.line), quadrantBottom - row),
        /** centre of the x MEDIAN label: on its line, inside the plot */
        medianXCentre: (linePx: number, textWidth: number) =>
            Math.min(Math.max(linePx, area.left + textWidth / 2 + 4), area.right - textWidth / 2 - 4),
    };
}

/** The one-line empty state when the loaded season has no values to plot, or null when there is something to draw. */
export function emptyChartMessage(points: { x: unknown; y: unknown }[], x: string, y: string, season: string | number): string | null {
    const has = (k: 'x' | 'y') => points.some((p) => Number.isFinite(p[k]));
    const missing = [!has('x') && x, !has('y') && y].filter((m): m is string => !!m);
    if (points.length > 0 && missing.length === 0) return null;
    const metrics = missing.length === 1 ? generateTeamMetricTitle(missing[0]) : `${generateTeamMetricTitle(x)} vs ${generateTeamMetricTitle(y)}`;
    return `No data for ${metrics} in ${season}.`;
}

export function builderUrl(league: League, s: { season: string | number; x: string; y: string; hl?: string; mode?: MarkMode }): string {
    const q = new URLSearchParams({ season: String(s.season), x: s.x, y: s.y });
    if (s.hl?.trim()) q.set('hl', s.hl.trim());
    if (s.mode === 'dots') q.set('mode', 'dots');
    return leaguePath(league, `/charts/builder?${q}`);
}

/**
 * Keep a builder navigation on the uncacheable /preview surface when it started there (as Footer.astro does
 * for links): a public URL can serve its cached copy, which has no v2 props.
 */
export function keepPreviewSurface(target: string, pathname: string): string {
    const onPreview = pathname === PREVIEW_PATH_PREFIX || pathname.startsWith(`${PREVIEW_PATH_PREFIX}/`);
    return onPreview ? `${PREVIEW_PATH_PREFIX}${target}` : target;
}
