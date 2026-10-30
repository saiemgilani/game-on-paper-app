<script lang="ts">
    import ChartSvg from './ChartSvg.svelte';
    import type { Draw } from '../chartFrame';
    import { periodShort } from '../../../basketball/periods';
    import type { Court, PeriodKind } from '../../../basketball/config';
    import { COURT } from '../../../nba/data/court';
    import { describeShots, GAME_SHOT_VIEWBOX, renderGameShotChart, type GameShot } from '../../../nba/charts/gameShotChart';
    let { shots, title, periods, regulationPeriods = 4, periodKind = 'quarter', court = COURT }: { shots: GameShot[]; title: string; periods: number; regulationPeriods?: number; periodKind?: PeriodKind; court?: Court } = $props();
    let period = $state<number | null>(null);
    const shown = $derived(period === null ? shots : shots.filter((s) => s.period === period));
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => { const d = shown; const c = court; return (svg, width) => renderGameShotChart(svg, d, { width, court: c }); });
    const labels = $derived(Array.from({ length: periods }, (_, i) => periodShort(i + 1, regulationPeriods, periodKind)));
</script>

<div class="btn-group btn-group-sm mb-2 flex-wrap" role="group" aria-label={`${title}: period`}>
    <button type="button" class="btn btn-outline-secondary" class:active={period === null} aria-pressed={period === null} onclick={() => (period = null)}>All</button>
    {#each labels as l, i (l)}
        <button type="button" class="btn btn-outline-secondary" class:active={period === i + 1} aria-pressed={period === i + 1} onclick={() => (period = i + 1)}>{l}</button>
    {/each}
</div>
<ChartSvg {draw} viewBox={GAME_SHOT_VIEWBOX} {title} desc={describeShots(shown, court)} />
<!-- the svg desc already reads this to screen readers -->
<p class="small text-muted mb-3" aria-hidden="true">{describeShots(shown, court)}</p>
