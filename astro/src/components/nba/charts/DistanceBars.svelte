<script lang="ts">
    import { describeBars, DISTANCE_BARS_VIEWBOX, renderDistanceBars, type BarMetric, type DistanceBarsData } from '../../../nba/charts/distanceBars';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, metric, title, subjectLabel = 'Player' }: { data: DistanceBarsData; metric: BarMetric; title: string; subjectLabel?: string } = $props();
    const draw: Draw = $derived((svg, width, animate) => renderDistanceBars(svg, data, { metric, width, subjectLabel, animate }));
</script>

<ChartSvg {draw} viewBox={DISTANCE_BARS_VIEWBOX} {title} desc={describeBars(data, metric, subjectLabel)} />
