<script lang="ts">
    import { describeRolling, renderRollingChart, ROLLING_VIEWBOX, type RollingData } from '../../../nba/charts/rollingChart';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, title }: { data: RollingData; title: string } = $props();
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const d = data;
        return (svg, width, animate) => renderRollingChart(svg, d, { width, animate });
    });
</script>

<ChartSvg {draw} viewBox={ROLLING_VIEWBOX} {title} desc={describeRolling(data)} />
