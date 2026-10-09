<script lang="ts">
    import { describeVersus, renderVersus, versusViewBox, type VersusData } from '../../../nba/charts/versusChart';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, title }: { data: VersusData; title: string } = $props();
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const d = data;
        return (svg, width, animate) => renderVersus(svg, d, { width, animate });
    });
</script>

<ChartSvg {draw} viewBox={versusViewBox(data.rows.length)} {title} desc={describeVersus(data)} />
