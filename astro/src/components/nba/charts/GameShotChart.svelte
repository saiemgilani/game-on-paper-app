<script lang="ts">
    import ChartSvg from './ChartSvg.svelte';
    import type { Draw } from '../chartFrame';
    import { periodShort } from '../game/periodLabel';
    import { describeShots, GAME_SHOT_VIEWBOX, renderGameShotChart, type GameShot } from '../../../nba/charts/gameShotChart';
    let { shots, title, periods }: { shots: GameShot[]; title: string; periods: number } = $props();
    let period = $state<number | null>(null);
    const shown = $derived(period === null ? shots : shots.filter((s) => s.period === period));
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => { const d = shown; return (svg, width) => renderGameShotChart(svg, d, { width }); });
    const labels = $derived(Array.from({ length: periods }, (_, i) => periodShort(i + 1)));
</script>

<div class="btn-group btn-group-sm mb-2 flex-wrap" role="group" aria-label="Period">
    <button type="button" class="btn btn-outline-secondary" class:active={period === null} aria-pressed={period === null} onclick={() => (period = null)}>All</button>
    {#each labels as l, i (l)}
        <button type="button" class="btn btn-outline-secondary" class:active={period === i + 1} aria-pressed={period === i + 1} onclick={() => (period = i + 1)}>{l}</button>
    {/each}
</div>
<ChartSvg {draw} viewBox={GAME_SHOT_VIEWBOX} {title} desc={describeShots(shown)} />
<p class="small text-muted mb-3">{describeShots(shown)}</p>
