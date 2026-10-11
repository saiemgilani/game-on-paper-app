<!-- src/components/nba/charts/ScatterChart.svelte -->
<script lang="ts">
    // blazing-the-nets' ScatterChart.tsx: the svg plus a canvas laid exactly under it (faces).
    // The zoom transform lives in a plain variable so redraws for other reasons (filter, axis,
    // resize) keep the view; a new resetKey returns to identity.
    import { zoomIdentity, type ZoomTransform } from 'd3-zoom';
    import { describeScatter, renderScatter, SCATTER_VIEWBOX } from '../../../nba/charts/scatterChart';
    import type { ScatterMetric, ScatterPoint } from '../../../nba/scatterMetrics';
    import type { Draw } from '../chartFrame';
    import ChartSvg from './ChartSvg.svelte';
    let { points, x, y, faces, filter, resetKey, title }: { points: ScatterPoint[]; x: ScatterMetric; y: ScatterMetric; faces: boolean; filter: string; resetKey: number; title: string } = $props();
    let canvas: HTMLCanvasElement | null = $state(null);
    let transform: ZoomTransform = zoomIdentity;
    let lastReset = resetKey;
    // read every input here, not inside the closure: that is what makes the derived change and Svelte call the action's update
    const draw: Draw = $derived.by(() => {
        const p = points, ax = x, ay = y, f = faces, q = filter, key = resetKey, c = canvas;
        return (svg, width, _animate) => {
            if (lastReset !== key) { lastReset = key; transform = zoomIdentity; }
            return renderScatter(svg, p, { width, x: ax, y: ay, faces: f, filter: q, transform, onZoom: (t) => { transform = t; }, canvas: c });
        };
    });
</script>

<!-- the canvas sits under the svg (its own stacking context) so names and medians stay on top of faces -->
<div class="position-relative nba-scatter">
    <canvas bind:this={canvas} aria-hidden="true" class="position-absolute top-0 start-0 w-100 h-100 pe-none" style="z-index: -1"></canvas>
    <ChartSvg {draw} viewBox={SCATTER_VIEWBOX} {title} desc={describeScatter(points, x, y)} />
</div>
