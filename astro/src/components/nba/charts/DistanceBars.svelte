<script lang="ts">
    import { describeBars, DISTANCE_BARS_VIEWBOX, renderDistanceBars, type BarMetric, type DistanceBarsData } from '../../../nba/charts/distanceBars';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, metric, title, subjectLabel = 'Player' }: { data: DistanceBarsData; metric: BarMetric; title: string; subjectLabel?: string } = $props();
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const d = data, m = metric, l = subjectLabel;
        return (svg, width, animate) => renderDistanceBars(svg, d, { metric: m, width, subjectLabel: l, animate });
    });
</script>

<ChartSvg {draw} viewBox={DISTANCE_BARS_VIEWBOX} {title} desc={describeBars(data, metric, subjectLabel)} />
