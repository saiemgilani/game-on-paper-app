// @vitest-environment jsdom
// #330: switching Metric History's category must swap the metric list (it kept the
// old category's metrics, so Net Yards/Play etc. could not be picked).
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import TeamTrendsChart from '../src/components/charts/TeamTrendsChart.svelte';
import { SDV_TEAM_METRIC_CATEGORIES } from '../src/utils/constants';

test('category switch rebuilds the metric options', () => {
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
    const target = document.body.appendChild(document.createElement('div'));
    const app = mount(TeamTrendsChart, { target, props: { title: 't', teamColor: '#000', teamData: [], percentiles: [] } });
    flushSync();
    const [category, metric] = [...target.querySelectorAll('select')];
    const metricValues = () => [...metric.querySelectorAll('option:not([disabled])')].map((o) => (o as HTMLOptionElement).value).sort();
    const pick = (value: string) => {
        category.value = value;
        category.dispatchEvent(new Event('change', { bubbles: true }));
        flushSync();
    };

    expect(metricValues()).toEqual(Object.keys(SDV_TEAM_METRIC_CATEGORIES.offensive).sort());
    for (const c of ['differential', 'defensive', 'offensive']) {
        pick(c);
        expect(metricValues()).toEqual(Object.keys(SDV_TEAM_METRIC_CATEGORIES[c]).sort());
        expect(SDV_TEAM_METRIC_CATEGORIES[c]).toHaveProperty(metric.value);
    }
    unmount(app);
});
