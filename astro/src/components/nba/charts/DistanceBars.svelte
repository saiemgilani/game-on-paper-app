<script lang="ts">
    import { describeBars, DISTANCE_BARS_VIEWBOX, renderDistanceBars, type BarMetric, type DistanceBarsData } from '../../../nba/charts/distanceBars';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    // `pinnable` (BB-G39, the game page): a click holds the bin on the linked charts
    let { data, metric, title, subjectLabel = 'Player', pinnable = false }: { data: DistanceBarsData; metric: BarMetric; title: string; subjectLabel?: string; pinnable?: boolean } = $props();
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const d = data, m = metric, l = subjectLabel, p = pinnable;
        return (svg, width, animate) => renderDistanceBars(svg, d, { metric: m, width, subjectLabel: l, animate, pinnable: p });
    });
</script>

<ChartSvg {draw} viewBox={DISTANCE_BARS_VIEWBOX} {title} desc={describeBars(data, metric, subjectLabel)} />
