<script lang="ts">
    // BB-G39, the game page: one distance bar chart with a Share / FG% toggle, so the shot diet sits in the same height.
    import DistanceBars from './DistanceBars.svelte';
    import type { BarMetric, DistanceBarsData } from '../../../nba/charts/distanceBars';
    let { data, team, subjectLabel }: { data: DistanceBarsData; team: string; subjectLabel: string } = $props();
    let metric: BarMetric = $state('fgPct');
    const METRICS: { key: BarMetric; label: string; heading: string; title: string }[] = [
        { key: 'share', label: 'Share', heading: 'Share of shots by distance', title: 'share of shots by distance vs league' },
        { key: 'fgPct', label: 'FG%', heading: 'Field goal percentage by distance', title: 'FG% by distance vs league' },
    ];
    const current = $derived(METRICS.find((m) => m.key === metric)!);
</script>

<div class="d-flex align-items-center justify-content-between mt-2 gap-2">
    <h4 class="h6 small text-muted m-0">{current.heading}</h4>
    <div class="btn-group btn-group-sm" role="group" aria-label={`${team}: distance bars`}>
        {#each METRICS as m (m.key)}
            <button type="button" class="btn btn-outline-secondary" class:active={metric === m.key} aria-pressed={metric === m.key} onclick={() => (metric = m.key)}>{m.label}</button>
        {/each}
    </div>
</div>
<DistanceBars {data} {metric} {subjectLabel} pinnable title={`${team} ${current.title}`} />
