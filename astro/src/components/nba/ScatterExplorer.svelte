<!-- src/components/nba/ScatterExplorer.svelte -->
<script lang="ts">
    // blazing-the-nets' ScatterExplorer.tsx on runes: axis pickers, Random, dots/faces, a name
    // filter and a zoom reset around the league scatter.
    import { randomPair, SCATTER_DEFAULT, SCATTER_INFO, SCATTER_METRICS, type ScatterMetric, type ScatterPoint } from '../../nba/scatterMetrics';
    import ScatterChart from './charts/ScatterChart.svelte';
    let { points, subject }: { points: ScatterPoint[]; subject: string } = $props();
    let x = $state<ScatterMetric>(SCATTER_DEFAULT.x);
    let y = $state<ScatterMetric>(SCATTER_DEFAULT.y);
    let faces = $state(false);
    let filter = $state('');
    let resetKey = $state(0);
    const random = () => { const [a, b] = randomPair(); x = a; y = b; };
    const title = $derived(`${subject}: ${SCATTER_INFO[y].label} against ${SCATTER_INFO[x].label}`);
</script>

<div class="d-flex flex-wrap align-items-center gap-3 mb-2">
    <label class="d-inline-flex align-items-center gap-2 small text-muted">Y
        <select name="y" class="form-select form-select-sm w-auto" bind:value={y}>
            {#each SCATTER_METRICS as m (m)}<option value={m}>{SCATTER_INFO[m].label}</option>{/each}
        </select>
    </label>
    <label class="d-inline-flex align-items-center gap-2 small text-muted">X
        <select name="x" class="form-select form-select-sm w-auto" bind:value={x}>
            {#each SCATTER_METRICS as m (m)}<option value={m}>{SCATTER_INFO[m].label}</option>{/each}
        </select>
    </label>
    <button type="button" class="btn btn-sm btn-outline-secondary" onclick={random}>Random</button>
    <div class="btn-group btn-group-sm" role="group" aria-label="Marks">
        <button type="button" class="btn btn-outline-secondary" class:active={!faces} aria-pressed={!faces} onclick={() => (faces = false)}>Dots</button>
        <button type="button" class="btn btn-outline-secondary" class:active={faces} aria-pressed={faces} onclick={() => (faces = true)}>Faces</button>
    </div>
    <button type="button" class="btn btn-sm btn-outline-secondary" onclick={() => (resetKey += 1)}>Reset zoom</button>
</div>
<label class="d-flex flex-wrap align-items-center gap-2 small text-muted mb-2">Find
    <input type="search" list="nba-scatter-names" class="form-control form-control-sm w-auto" placeholder="player name" bind:value={filter} />
    <datalist id="nba-scatter-names">
        {#each points as p (p.person_id)}<option value={p.name}></option>{/each}
    </datalist>
</label>
<ScatterChart {points} {x} {y} {faces} {filter} {resetKey} {title} />
<p class="small text-muted mt-2">Players with 100+ FGA. <span class="fw-bold">Nets</span> with names, others in their team colours; dashed lines are the league medians. Scroll the wheel or pinch to zoom; drag (two fingers on a touch screen) to pan. Season stats where the release has them, shots otherwise.</p>
