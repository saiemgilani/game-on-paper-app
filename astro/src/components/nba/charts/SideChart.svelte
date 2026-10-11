<script lang="ts">
    import type { BarMetric } from '../../../nba/charts/distanceBars';
    import { describeSides, renderSideChart, sideViewBox, type SideChartData } from '../../../nba/charts/sideChart';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, metric, title }: { data: SideChartData; metric: BarMetric; title: string } = $props();
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const d = data, m = metric;
        return (svg, width, animate) => renderSideChart(svg, d, { metric: m, width, animate });
    });
</script>

<ChartSvg {draw} viewBox={sideViewBox(data.player.length)} {title} desc={describeSides(data, metric)} />
