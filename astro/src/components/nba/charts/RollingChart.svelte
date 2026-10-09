<script lang="ts">
    import { describeRolling, renderRollingChart, ROLLING_VIEWBOX, type RollingData } from '../../../nba/charts/rollingChart';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, title }: { data: RollingData; title: string } = $props();
    const draw: Draw = $derived((svg, width, animate) => renderRollingChart(svg, data, { width, animate }));
</script>

<ChartSvg {draw} viewBox={ROLLING_VIEWBOX} {title} desc={describeRolling(data)} />
