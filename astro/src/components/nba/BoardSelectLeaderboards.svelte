<!-- src/components/nba/BoardSelectLeaderboards.svelte -->
<script lang="ts">
    // BB-G11: the rolling leaders with five or more boards (the movers' Most declined is the fifth). A button row that long
    // wraps on phones, so one labelled select picks the board at every width; the boards themselves are Leaderboards'.
    import type { ComponentProps } from 'svelte';
    import Leaderboards from './Leaderboards.svelte';
    import { LEADER_LABELS, LEADER_METRICS, MOVER_METRIC, type LeaderMetric } from '../../nba/data/leaders';
    let props: Omit<ComponentProps<typeof Leaderboards>, 'metric' | 'boardButtons'> = $props();
    let metric = $state<LeaderMetric>('efgPct');
    const metrics: readonly LeaderMetric[] = $derived(props.movers ? [...LEADER_METRICS, MOVER_METRIC] : LEADER_METRICS);
</script>

<div class="d-flex align-items-center gap-2 mb-2">
    <label class="small text-muted" for="leaders-board">Board</label>
    <select id="leaders-board" class="form-select form-select-sm w-auto" bind:value={metric}>
        {#each metrics as m (m)}<option value={m}>{LEADER_LABELS[m]}</option>{/each}
    </select>
</div>
<Leaderboards {...props} bind:metric boardButtons={false} />
