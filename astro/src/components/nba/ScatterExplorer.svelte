<!-- src/components/nba/ScatterExplorer.svelte -->
<script lang="ts">
    // blazing-the-nets' ScatterExplorer.tsx on runes: axis pickers, Random, dots/faces, a name
    // filter and a zoom reset around the league scatter.
    import { randomPair, SCATTER_DEFAULT, SCATTER_INFO, SCATTER_METRICS, type AxisMetric, type ScatterPoint } from '../../nba/scatterMetrics';
    import ScatterChart from './charts/ScatterChart.svelte';
    // BB-G10 ('bball-impact-scatter') passes the axes, their defaults, the noun and the footnote's two sentences; left out, they are the shooting view's
    let { points, subject, highlight = 'Nets', minFga = 100, metrics = SCATTER_METRICS, initial = SCATTER_DEFAULT, noun = 'player', population, lead, tail, logos = false }: {
        points: ScatterPoint[]; subject: string; highlight?: string | null; minFga?: number;
        metrics?: readonly AxisMetric[]; initial?: { x: AxisMetric; y: AxisMetric }; noun?: string; population?: string; lead?: string; tail?: string; logos?: boolean;
    } = $props();
    // svelte-ignore state_referenced_locally -- the defaults are the first view; the pickers own the axes after that
    let x = $state<AxisMetric>(initial.x);
    // svelte-ignore state_referenced_locally
    let y = $state<AxisMetric>(initial.y);
    // svelte-ignore state_referenced_locally -- the team view opens on logos (its points' `headshot`)
    let faces = $state(logos);
    let filter = $state('');
    let resetKey = $state(0);
    const random = () => { const [a, b] = randomPair(Math.random, metrics); x = a; y = b; };
    const title = $derived(`${subject}: ${SCATTER_INFO[y].label} against ${SCATTER_INFO[x].label}`);
    // ponytail: with no highlight the bold span below is empty (invisible); an {#if} would add hydration markers to the NBA's HTML
</script>

<div class="d-flex flex-wrap align-items-center gap-3 mb-2">
    <label class="d-inline-flex align-items-center gap-2 small text-muted">Y
        <select name="y" class="form-select form-select-sm w-auto" bind:value={y}>
            {#each metrics as m (m)}<option value={m}>{SCATTER_INFO[m].label}</option>{/each}
        </select>
    </label>
    <label class="d-inline-flex align-items-center gap-2 small text-muted">X
        <select name="x" class="form-select form-select-sm w-auto" bind:value={x}>
            {#each metrics as m (m)}<option value={m}>{SCATTER_INFO[m].label}</option>{/each}
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
    <input type="search" list="nba-scatter-names" class="form-control form-control-sm w-auto" placeholder="{noun} name" bind:value={filter} />
    <datalist id="nba-scatter-names">
        {#each points as p (p.person_id)}<option value={p.name}></option>{/each}
    </datalist>
</label>
<ScatterChart {points} {x} {y} {faces} {filter} {resetKey} {title} {highlight} {minFga} {population} />
<p class="small text-muted mt-2">{lead ?? `Players with ${minFga}+ FGA.`} <span class="fw-bold">{highlight ?? ''}</span>{highlight ? ' with names, others' : 'Each'} in their team colours; dashed lines are the league medians. Scroll the wheel or pinch to zoom; drag (two fingers on a touch screen) to pan. {tail ?? 'Season stats where the release has them, shots otherwise.'}</p>
