<script lang="ts">
    import { describeHex, HEX_VIEWBOX, renderHexShotChart, type HexMode, type HexShotChartData } from '../../../nba/charts/hexShotChart';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { data, title }: { data: HexShotChartData; title: string } = $props();
    let mode: HexMode = $state('raw');
    const modes: { mode: HexMode; label: string }[] = [{ mode: 'raw', label: 'Raw' }, { mode: 'zones', label: 'Zones' }];
    const draw: Draw = $derived((svg, width, animate) => renderHexShotChart(svg, data, { width, mode, animate }));
</script>

<div class="btn-group btn-group-sm mb-2" role="group" aria-label="Shot chart view">
    {#each modes as m (m.mode)}
        <button type="button" class="btn btn-outline-secondary" class:active={mode === m.mode} aria-pressed={mode === m.mode} onclick={() => (mode = m.mode)}>{m.label}</button>
    {/each}
</div>
<ChartSvg {draw} viewBox={HEX_VIEWBOX} {title} desc={describeHex(data)} />
