<script lang="ts">
    import { describeVersus, renderVersus, versusViewBox, type VersusData } from '../../../nba/charts/versusChart';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, title }: { data: VersusData; title: string } = $props();
    const draw: Draw = $derived((svg, width, animate) => renderVersus(svg, data, { width, animate }));
</script>

<ChartSvg {draw} viewBox={versusViewBox(data.rows.length)} {title} desc={describeVersus(data)} />
