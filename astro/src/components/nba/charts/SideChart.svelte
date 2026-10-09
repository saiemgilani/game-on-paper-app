<script lang="ts">
    import type { BarMetric } from '../../../nba/charts/distanceBars';
    import { describeSides, renderSideChart, sideViewBox, type SideChartData } from '../../../nba/charts/sideChart';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, metric, title }: { data: SideChartData; metric: BarMetric; title: string } = $props();
    const draw: Draw = $derived((svg, width, animate) => renderSideChart(svg, data, { metric, width, animate }));
</script>

<ChartSvg {draw} viewBox={sideViewBox(data.player.length)} {title} desc={describeSides(data, metric)} />
