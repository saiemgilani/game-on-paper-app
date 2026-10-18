// @vitest-environment jsdom
// #330: switching Metric History's category must swap the metric list (it kept the
// old category's metrics, so Net Yards/Play etc. could not be picked), and the chart
// and the dropdown must land on the same metric of the new category.
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import TeamTrendsChart from '../src/components/charts/TeamTrendsChart.svelte';
import { EVENT_KEY_TRENDS_METRIC_CHANGED, SDV_TEAM_METRIC_CATEGORIES } from '../src/utils/constants';
import { modifyMetricForCategory } from '../src/utils/misc';

const CATEGORIES = ['offensive', 'defensive', 'differential'];

test('modifyMetricForCategory maps every metric into the target category', () => {
    for (const from of CATEGORIES) {
        for (const m of Object.keys(SDV_TEAM_METRIC_CATEGORIES[from])) {
            for (const to of CATEGORIES) {
                expect(SDV_TEAM_METRIC_CATEGORIES[to], `${m} -> ${to}`).toHaveProperty(modifyMetricForCategory(to, m));
            }
        }
    }
    // a counterpart keeps its stat; no counterpart falls back to the category's first metric
    expect(modifyMetricForCategory('defensive', 'EPAplay_off_pass')).toBe('EPAplay_def_pass');
    expect(modifyMetricForCategory('differential', 'EPAplay_off_pass')).toBe('net_adj_epa');
    expect(modifyMetricForCategory('differential', 'havoc_def')).toBe('net_adj_epa');
});

test('category switch keeps the chart and the dropdown on the same metric', () => {
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
    let charted = '';
    const onChart = (e: Event) => { charted = (e as CustomEvent).detail.metric; };
    document.addEventListener(EVENT_KEY_TRENDS_METRIC_CHANGED, onChart);
    const target = document.body.appendChild(document.createElement('div'));
    const app = mount(TeamTrendsChart, { target, props: { title: 't', teamColor: '#000', teamData: [], percentiles: [] } });
    flushSync();
    const [category, metric] = [...target.querySelectorAll('select')];
    const metricValues = () => [...metric.querySelectorAll('option:not([disabled])')].map((o) => (o as HTMLOptionElement).value).sort();
    const pick = (select: HTMLSelectElement, value: string) => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        flushSync();
    };
    const expectInSync = (c: string, label: string) => {
        expect(metricValues(), label).toEqual(Object.keys(SDV_TEAM_METRIC_CATEGORIES[c]).sort());
        expect(SDV_TEAM_METRIC_CATEGORIES[c], label).toHaveProperty(charted);
        // the option the select shows is the metric the chart received, not a stale one
        expect(metric.selectedOptions[0]?.value, label).toBe(charted);
    };

    expect(metricValues()).toEqual(Object.keys(SDV_TEAM_METRIC_CATEGORIES.offensive).sort());
    for (const from of CATEGORIES) {
        for (const m of Object.keys(SDV_TEAM_METRIC_CATEGORIES[from])) {
            for (const to of CATEGORIES.filter((c) => c !== from)) {
                pick(category, from);
                pick(metric, m);
                expectInSync(from, `${from}:${m}`);
                pick(category, to);
                expectInSync(to, `${from}:${m} -> ${to}`);
            }
        }
    }
    unmount(app);
    document.removeEventListener(EVENT_KEY_TRENDS_METRIC_CHANGED, onChart);
});
